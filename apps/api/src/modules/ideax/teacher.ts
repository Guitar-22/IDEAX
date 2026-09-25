/** Gate 1 · อาจารย์ — review queue, human decisions on AI proposals, release, summary, insights */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ANNOTATIONS, DecisionBody, ReleaseBody, INSIGHT_GROUPS, type InsightGroup } from '@ideax/contracts';
import type { Deps } from '../../app.js';
import type { Queryable } from '../../db/index.js';
import { audit, trace } from '../../core/audit.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { actorOf, parse, requireRole, type UserRow } from '../../core/http.js';
import {
  assertReviewer,
  buildSnapshot,
  insightGroup,
  INSIGHT_TODO,
  loadVersion,
  reviewItemsFor,
  summarize,
  type VersionCtx,
} from './service.js';

const REVIEWERS = ['thesis_mentor', 'assistant_marker'] as const;

async function releaseOf(q: Queryable, versionId: string) {
  const rows = await q.query<{ release_version: number; mode: string; released_at: Date; released_by: string; snapshot: any }>(
    'select * from feedback_releases where submission_version_id = $1 order by release_version desc limit 1',
    [versionId],
  );
  return rows[0] ?? null;
}

async function reviewContext(q: Queryable, user: UserRow, versionId: string, opts: { release?: boolean } = {}) {
  const ctx = await loadVersion(q, versionId);
  await assertReviewer(q, user, ctx, opts);
  return ctx;
}

function itemView(i: Awaited<ReturnType<typeof reviewItemsFor>>[number]) {
  return {
    no: i.item_no,
    criterionId: i.criterion_id,
    text: i.text,
    status: i.status,
    grade: i.grade,
    aiGrade: i.ai_grade,
    reason: i.reason,
    ann: i.ann,
    rowVersion: i.row_version,
    kind: i.kind,
    why: i.why,
    feedback: i.feedback,
    anchors: i.anchor_codes ?? [],
    reasonCode: i.reason_code,
    decidedBy: i.decided_by_name,
    decidedAt: i.decided_at,
  };
}

async function markInReview(q: Queryable, ctx: VersionCtx) {
  await q.query(`update submissions set status = 'IN_REVIEW' where id = $1 and status in ('SUBMITTED', 'RESUBMITTED')`, [ctx.submission.id]);
}

export function registerTeacher(app: FastifyInstance, deps: Deps) {
  const { db, clock } = deps;

  app.get('/v1/teacher/courses', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const rows = await db.query(
      `select c.id, c.name, c.code,
              (select count(*)::int from enrollments e where e.course_id = c.id and e.role = 'student') as students,
              (select json_agg(json_build_object('id', a.id, 'title', a.title, 'dueAt', a.due_at, 'verification', a.verification) order by a.due_at)
                 from assignments a where a.course_id = c.id) as assignments
       from courses c
       where c.instructor_id = $1 or exists (select 1 from enrollments e where e.course_id = c.id and e.user_id = $1 and e.role = 'marker')
       order by c.name`,
      [u.id],
    );
    return { courses: rows };
  });

  /**
   * Order from the architecture doc p.4 (mockup tQueue): due soon → needs a decision → revisions →
   * the rest. Never sorted by grade.
   */
  app.get('/v1/teacher/queue', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const rows = await db.query(
      `select s.id as submission_id, s.status, v.id as version_id, v.version_no, v.received_at, v.word_count, v.receipt_id,
              a.id as assignment_id, a.title, a.due_at, c.name as course_name, st.id as student_id, st.name as student_name,
              r.status as analysis_status,
              (select count(*)::int from review_items ri where ri.submission_version_id = v.id) as items_total,
              (select count(*)::int from review_items ri where ri.submission_version_id = v.id and ri.status in ('VERIFIED', 'RETURNED_FOR_REVISION')) as items_decided,
              (select count(*)::int from review_items ri where ri.submission_version_id = v.id and ri.status = 'NO_PROPOSAL') as items_attention,
              exists (select 1 from feedback_releases f where f.submission_version_id = v.id) as released
       from submissions s
       join lateral (select * from submission_versions x where x.submission_id = s.id order by x.version_no desc limit 1) v on true
       join assignments a on a.id = s.assignment_id
       join courses c on c.id = a.course_id
       join users st on st.id = s.student_id
       left join lateral (select status from analysis_runs ar where ar.submission_version_id = v.id order by created_at desc limit 1) r on true
       where c.instructor_id = $1 or exists (select 1 from enrollments e where e.course_id = c.id and e.user_id = $1 and e.role = 'marker')`,
      [u.id],
    );
    const now = clock.now().getTime();
    const bucket = (r: any) => {
      if (r.released) return 4;
      const dueSoon = new Date(r.due_at).getTime() - now < 3 * 24 * 3600 * 1000;
      if (dueSoon) return 0;
      if (r.items_total > r.items_decided) return r.version_no > 1 ? 2 : 1;
      return 3;
    };
    rows.sort((a, b) => bucket(a) - bucket(b) || new Date(a.due_at).getTime() - new Date(b.due_at).getTime() || String(a.student_name).localeCompare(String(b.student_name), 'th'));
    return { queue: rows.map((r) => ({ ...r, bucket: bucket(r) })) };
  });

  app.get('/v1/reviews/:svid', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const { svid } = req.params as { svid: string };
    const ctx = await reviewContext(db, u, svid);
    const [rubric] = await db.query('select * from rubrics where id = $1', [ctx.assignment.rubric_id]);
    const criteria = await db.query('select id, no, name, purpose, th from rubric_criteria where rubric_id = $1 order by position', [rubric.id]);
    const items = await reviewItemsFor(db, svid);
    const anchors = await db.query('select code, loc, start_offset as start, end_offset as "end" from anchors where submission_version_id = $1 order by start_offset', [svid]);
    const [analysis] = await db.query('select status, attempts, model, last_error from analysis_runs where submission_version_id = $1 order by created_at desc limit 1', [svid]);
    const diagnostics = await db.query(`select at, kind, detail from diagnostics where subject_kind = 'submission_version' and subject_id = $1 order by id desc`, [svid]);
    const versions = await db.query('select id, version_no, received_at, receipt_id from submission_versions where submission_id = $1 order by version_no', [ctx.submission.id]);
    const verification = await db.query('select position, question, answer, explained, why from verification_questions where submission_version_id = $1 order by position', [svid]);
    const release = await releaseOf(db, svid);
    return {
      version: {
        id: ctx.version.id,
        versionNo: ctx.version.version_no,
        receiptId: ctx.version.receipt_id,
        receivedAt: ctx.version.received_at,
        words: ctx.version.word_count,
        sha256: ctx.version.sha256,
        content: ctx.version.content,
        revisionNote: ctx.version.revision_note,
      },
      versions,
      submission: { id: ctx.submission.id, status: ctx.submission.status },
      student: ctx.student,
      assignment: { id: ctx.assignment.id, title: ctx.assignment.title, dueAt: ctx.assignment.due_at, verification: ctx.assignment.verification },
      course: { id: ctx.course.id, name: ctx.course.name },
      rubric: { id: rubric.id, name: rubric.name, passMark: rubric.pass_mark, weighting: rubric.weights ? 'custom' : 'equal', source: rubric.source },
      criteria,
      items: items.map(itemView),
      anchors,
      analysis: analysis ?? null,
      diagnostics,
      summary: summarize(items),
      verification,
      release: release ? { version: release.release_version, mode: release.mode, releasedAt: release.released_at } : null,
      canRelease: u.role === 'thesis_mentor' && ctx.course.instructor_id === u.id,
      annotations: ANNOTATIONS,
    };
  });

  /** Accept / grade / flag one item. Optimistic lock on row_version (AC-11). */
  app.post('/v1/reviews/:svid/items/:no/decision', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const { svid, no } = req.params as { svid: string; no: string };
    const body = parse(DecisionBody, req.body);
    const ctx = await reviewContext(db, u, svid);
    return db.tx(async (q) => {
      if (await releaseOf(q, svid)) throw conflict('RELEASED_LOCKED', 'ปล่อยผลแล้ว แก้ผลรายข้อไม่ได้');
      const [item] = await q.query<any>(
        `select ri.*, du.name as decided_by_name from review_items ri left join users du on du.id = ri.decided_by
         where ri.submission_version_id = $1 and ri.item_no = $2 for update of ri`,
        [svid, no],
      );
      if (!item) throw notFound(`ข้อ ${no}`);
      if (item.row_version !== body.rowVersion) {
        throw conflict('REVIEW_CONFLICT', 'มีคนบันทึกผลข้อนี้ไปแล้วระหว่างที่คุณเปิดอยู่ ระบบไม่เขียนทับ', {
          theirs: { status: item.status, grade: item.grade, reason: item.reason, decidedBy: item.decided_by_name, decidedAt: item.decided_at, rowVersion: item.row_version },
        });
      }
      if (item.status === 'VERIFIED' || item.status === 'RETURNED_FOR_REVISION') {
        throw unprocessable('ALREADY_DECIDED', 'ข้อนี้ตัดสินแล้ว กดย้อนกลับก่อนหากต้องการเปลี่ยน');
      }
      const prev = item.ai_grade ? `AI_PROPOSED ${item.ai_grade}` : 'NO_PROPOSAL';
      let status: string;
      let grade: string | null;
      let reason = (body.reason ?? '').trim();
      let ann: string[] = item.ann;
      let next: string;
      if (body.action === 'accept') {
        if (item.status !== 'AI_PROPOSED' || !item.ai_grade) throw unprocessable('NO_PROPOSAL_TO_ACCEPT', 'ข้อนี้ไม่มีข้อเสนอให้ยืนยัน ต้องให้เกรดเอง');
        status = 'VERIFIED';
        grade = item.ai_grade;
        next = `VERIFIED ${grade}`;
      } else if (body.action === 'grade') {
        if (!body.grade) throw unprocessable('GRADE_REQUIRED', 'เลือกเกรดก่อนบันทึก');
        if ((item.ai_grade === null || body.grade !== item.ai_grade) && !reason) {
          throw unprocessable('REASON_REQUIRED', 'เกรดต่างจากที่ระบบเสนอ ต้องระบุเหตุผลหนึ่งบรรทัด');
        }
        status = 'VERIFIED';
        grade = body.grade;
        next = `VERIFIED ${grade}${item.ai_grade === null ? ' · human_only' : ''}`;
      } else {
        const codes = body.codes ?? [];
        if (!codes.length && !reason) throw unprocessable('FLAG_REASON_REQUIRED', 'เลือกรหัสอย่างน้อยหนึ่งตัว หรือเขียนสิ่งที่ต้องแก้');
        status = 'RETURNED_FOR_REVISION';
        grade = null; // returned items carry no grade and never count as F
        ann = [...new Set([...item.ann, ...codes])];
        next = 'RETURNED_FOR_REVISION (grade=null)';
        reason = [codes.join(' '), reason].filter(Boolean).join(' · ');
      }
      const updated = await q.query(
        `update review_items set status = $3, grade = $4, reason = $5, ann = $6, row_version = row_version + 1, decided_by = $7, decided_at = $8
         where submission_version_id = $1 and item_no = $2 and row_version = $9 returning row_version`,
        [svid, no, status, grade, reason, ann, u.id, clock.now(), body.rowVersion],
      );
      if (!updated.length) throw conflict('REVIEW_CONFLICT', 'มีคนบันทึกผลข้อนี้ไปแล้วระหว่างที่คุณเปิดอยู่ ระบบไม่เขียนทับ');
      await q.query(
        `insert into review_decisions(submission_version_id, item_nos, action, prev, next, reason, actor_id, at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [svid, [no], body.action, prev, next, reason || 'accept_proposal', u.id, clock.now()],
      );
      await markInReview(q, ctx);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `TeacherReview · ${ctx.student.name} · ข้อ ${no}`, prev, next, reason: reason || 'accept_proposal' });
      await trace(q, { cid: req.cid, actorId: u.id, type: 'review.decided', context: { kind: 'submission', id: ctx.submission.id }, payload: { item: no, action: body.action, grade } });
      const items = await reviewItemsFor(q, svid);
      return { item: itemView(items.find((i) => i.item_no === no)!), summary: summarize(items) };
    });
  });

  /** Accept every remaining proposal of one criterion: ONE human decision covering n items. */
  app.post('/v1/reviews/:svid/criteria/:cid/accept', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const { svid, cid } = req.params as { svid: string; cid: string };
    const ctx = await reviewContext(db, u, svid);
    return db.tx(async (q) => {
      if (await releaseOf(q, svid)) throw conflict('RELEASED_LOCKED', 'ปล่อยผลแล้ว แก้ผลรายข้อไม่ได้');
      const [crit] = await q.query('select * from rubric_criteria where rubric_id = $1 and id = $2', [ctx.assignment.rubric_id, cid]);
      if (!crit) throw notFound('เกณฑ์');
      const rows = await q.query<{ item_no: string; grade: string }>(
        `update review_items ri set status = 'VERIFIED', grade = ri.ai_grade, row_version = row_version + 1, decided_by = $3, decided_at = $4, reason = ''
         from rubric_items it
         where ri.submission_version_id = $1 and ri.status = 'AI_PROPOSED' and it.rubric_id = $2 and it.no = ri.item_no and it.criterion_id = $5
         returning ri.item_no, ri.grade`,
        [svid, ctx.assignment.rubric_id, u.id, clock.now(), cid],
      );
      if (!rows.length) throw unprocessable('NOTHING_TO_ACCEPT', 'ไม่มีข้อที่ระบบเสนอค้างอยู่ในเกณฑ์นี้');
      rows.sort((a, b) => a.item_no.localeCompare(b.item_no));
      const summaryText = rows.map((r) => `${r.item_no}=${r.grade}`).join(' ');
      await q.query(
        `insert into review_decisions(submission_version_id, item_nos, action, prev, next, reason, actor_id, at) values ($1, $2, 'bulk_accept', $3, $4, $5, $6, $7)`,
        [svid, rows.map((r) => r.item_no), `AI_PROPOSED ×${rows.length}`, `VERIFIED ×${rows.length} (${summaryText})`, `bulk_accept criterion ${crit.no}`, u.id, clock.now()],
      );
      await markInReview(q, ctx);
      await audit(q, {
        cid: req.cid,
        actor: actorOf(u),
        object: `TeacherReview · ${ctx.student.name} · เกณฑ์ ${crit.no} ${crit.name}`,
        prev: `AI_PROPOSED ×${rows.length}`,
        next: `VERIFIED ×${rows.length} (${summaryText})`,
        reason: `bulk_accept · หนึ่งการตัดสินใจของมนุษย์ครอบ ${rows.length} ข้อ`,
      });
      const items = await reviewItemsFor(q, svid);
      return { accepted: rows.map((r) => r.item_no), items: items.map(itemView), summary: summarize(items) };
    });
  });

  app.post('/v1/reviews/:svid/items/:no/annotations', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const { svid, no } = req.params as { svid: string; no: string };
    const { code } = parse(z.object({ code: z.enum(['U', 'D', 'J']) }), req.body);
    const ctx = await reviewContext(db, u, svid);
    return db.tx(async (q) => {
      if (await releaseOf(q, svid)) throw conflict('RELEASED_LOCKED', 'ปล่อยผลแล้ว แก้ผลรายข้อไม่ได้');
      const [item] = await q.query<{ ann: string[] }>('select ann from review_items where submission_version_id = $1 and item_no = $2 for update', [svid, no]);
      if (!item) throw notFound(`ข้อ ${no}`);
      const had = item.ann.includes(code);
      const ann = had ? item.ann.filter((c) => c !== code) : [...item.ann, code];
      await q.query('update review_items set ann = $3, row_version = row_version + 1 where submission_version_id = $1 and item_no = $2', [svid, no, ann]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Annotation · ${ctx.student.name} · ข้อ ${no}`, next: `${had ? 'removed' : 'added'} ${code}`, reason: ANNOTATIONS[code] });
      const items = await reviewItemsFor(q, svid);
      return { item: itemView(items.find((i) => i.item_no === no)!) };
    });
  });

  app.post('/v1/reviews/:svid/items/:no/undo', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const { svid, no } = req.params as { svid: string; no: string };
    const { rowVersion } = parse(z.object({ rowVersion: z.number().int() }), req.body);
    const ctx = await reviewContext(db, u, svid);
    return db.tx(async (q) => {
      if (await releaseOf(q, svid)) throw conflict('RELEASED_LOCKED', 'ปล่อยผลแล้ว ย้อนกลับไม่ได้');
      const [item] = await q.query<any>('select * from review_items where submission_version_id = $1 and item_no = $2 for update', [svid, no]);
      if (!item) throw notFound(`ข้อ ${no}`);
      if (item.row_version !== rowVersion) throw conflict('REVIEW_CONFLICT', 'ข้อนี้ถูกเปลี่ยนไปแล้ว โหลดฉบับล่าสุดก่อน', { theirs: { status: item.status, grade: item.grade } });
      if (item.status !== 'VERIFIED' && item.status !== 'RETURNED_FOR_REVISION') throw unprocessable('NOT_DECIDED', 'ข้อนี้ยังไม่ได้ตัดสิน');
      const back = item.ai_grade ? 'AI_PROPOSED' : 'NO_PROPOSAL';
      await q.query(
        `update review_items set status = $3, grade = ai_grade, reason = '', row_version = row_version + 1, decided_by = null, decided_at = null
         where submission_version_id = $1 and item_no = $2`,
        [svid, no, back],
      );
      await q.query(
        `insert into review_decisions(submission_version_id, item_nos, action, prev, next, reason, actor_id, at) values ($1, $2, 'undo', $3, 'REOPENED', 'undo_by_reviewer', $4, $5)`,
        [svid, [no], item.status, u.id, clock.now()],
      );
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `TeacherReview · ${ctx.student.name} · ข้อ ${no}`, prev: item.status, next: 'REOPENED', reason: 'undo_by_reviewer' });
      const items = await reviewItemsFor(q, svid);
      return { item: itemView(items.find((i) => i.item_no === no)!), summary: summarize(items) };
    });
  });

  app.get('/v1/reviews/:svid/release-preview', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const { svid } = req.params as { svid: string };
    const ctx = await reviewContext(db, u, svid);
    const items = await reviewItemsFor(db, svid);
    const pending = items.filter((i) => i.status === 'AI_PROPOSED' || i.status === 'NO_PROPOSAL').map((i) => i.item_no);
    return { pending, snapshot: await buildSnapshot(db, ctx, { releasedBy: u.name, releasedAt: clock.now(), mode: 'preview', note: '' }) };
  });

  app.post('/v1/reviews/:svid/release', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const { svid } = req.params as { svid: string };
    const body = parse(ReleaseBody, req.body);
    const ctx = await reviewContext(db, u, svid, { release: true });
    return db.tx(async (q) => {
      if (await releaseOf(q, svid)) throw conflict('ALREADY_RELEASED', 'ฉบับนี้ปล่อยผลไปแล้ว');
      const items = await reviewItemsFor(q, svid);
      if (!items.length) throw unprocessable('NOT_READY', 'ยังไม่มีรายการตรวจ รอการวิเคราะห์ก่อน');
      const pending = items.filter((i) => i.status === 'AI_PROPOSED' || i.status === 'NO_PROPOSAL').map((i) => i.item_no);
      if (pending.length) throw unprocessable('NOT_ALL_DECIDED', `ยังมี ${pending.length} ข้อที่ยังไม่ได้ตัดสิน`, { pending });
      const now = clock.now();
      const snapshot = await buildSnapshot(q, ctx, { releasedBy: u.name, releasedAt: now, mode: body.mode, note: body.note ?? '' });
      await q.query(
        `insert into feedback_releases(submission_version_id, release_version, mode, note, snapshot, released_by, released_at) values ($1, 1, $2, $3, $4, $5, $6)`,
        [svid, body.mode, body.note ?? '', JSON.stringify(snapshot), u.id, now],
      );
      const next = body.mode === 'revise' ? 'REVISION_REQUIRED' : 'FINALIZED';
      await q.query('update submissions set status = $2 where id = $1', [ctx.submission.id, next]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Feedback release · ${ctx.student.name}`, prev: 'IN_REVIEW', next, reason: `feedback_released rubric=${ctx.assignment.rubric_id}` });
      await trace(q, { cid: req.cid, actorId: u.id, type: 'feedback.released', context: { kind: 'submission', id: ctx.submission.id }, payload: { versionNo: ctx.version.version_no, mode: body.mode } });
      return { status: next, snapshot };
    });
  });

  /* ---------- course level ---------- */

  async function assertCourseStaff(q: Queryable, u: UserRow, courseId: string) {
    const rows = await q.query(
      `select 1 from courses c where c.id = $1 and (c.instructor_id = $2 or exists (select 1 from enrollments e where e.course_id = c.id and e.user_id = $2 and e.role = 'marker'))`,
      [courseId, u.id],
    );
    if (!rows.length) throw forbidden('คุณไม่ได้สอนรายวิชานี้');
  }

  /** Close-the-round summary (mockup tSummary): released results only. */
  app.get('/v1/courses/:id/summary', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const { id } = req.params as { id: string };
    await assertCourseStaff(db, u, id);
    const releases = await db.query<{ snapshot: any; student_name: string; assignment_id: string }>(
      `select distinct on (s.id) f.snapshot, st.name as student_name, s.assignment_id
       from feedback_releases f
       join submission_versions v on v.id = f.submission_version_id
       join submissions s on s.id = v.submission_id
       join assignments a on a.id = s.assignment_id
       join users st on st.id = s.student_id
       where a.course_id = $1
       order by s.id, v.version_no desc`,
      [id],
    );
    const criteria: Record<string, { name: string; values: number[] }> = {};
    const itemGaps: Record<string, { text: string; returned: number; below: number }> = {};
    for (const r of releases) {
      for (const c of r.snapshot.criteria) {
        criteria[c.id] ??= { name: `${c.no}. ${c.name}`, values: [] };
        if (c.average !== null) criteria[c.id].values.push(c.average);
        for (const it of c.items) {
          itemGaps[it.no] ??= { text: it.text, returned: 0, below: 0 };
          if (it.status === 'RETURNED_FOR_REVISION') itemGaps[it.no].returned++;
          else if (it.grade && ['F', 'D', 'D+', 'C'].includes(it.grade)) itemGaps[it.no].below++;
        }
      }
    }
    const n = releases.length;
    return {
      released: n,
      students: releases.map((r) => ({ name: r.student_name, average: r.snapshot.average, mode: r.snapshot.mode })),
      criteria: Object.entries(criteria).map(([cid, c]) => ({
        id: cid,
        name: c.name,
        average: c.values.length ? c.values.reduce((a, b) => a + b, 0) / c.values.length : null,
      })),
      // gaps that recur for at least half of the released students: candidates for a class-wide session
      sharedGaps: Object.entries(itemGaps)
        .filter(([, g]) => n > 0 && (g.returned + g.below) / n >= 0.5)
        .map(([no, g]) => ({ no, text: g.text, count: g.returned + g.below })),
      weighting: 'equal',
    };
  });

  /** Four groups for the teacher (plan p.51). Every student lands in one group with its evidence. */
  app.get('/v1/courses/:id/insights', async (req) => {
    const u = requireRole(req, ...REVIEWERS);
    const { id } = req.params as { id: string };
    const { assignmentId } = parse(z.object({ assignmentId: z.string().optional() }), req.query);
    await assertCourseStaff(db, u, id);
    const [assignment] = assignmentId
      ? await db.query('select * from assignments where id = $1 and course_id = $2', [assignmentId, id])
      : await db.query('select * from assignments where course_id = $1 order by due_at limit 1', [id]);
    if (!assignment) throw notFound('งานที่มอบหมาย');
    const [rubric] = await db.query('select pass_mark from rubrics where id = $1', [assignment.rubric_id]);
    const students = await db.query<{ id: string; name: string }>(
      `select u.id, u.name from enrollments e join users u on u.id = e.user_id where e.course_id = $1 and e.role = 'student' order by u.name`,
      [id],
    );
    const out: Array<{ student: { id: string; name: string }; group: InsightGroup; evidence: string[]; todo: (typeof INSIGHT_TODO)[InsightGroup] }> = [];
    for (const st of students) {
      const [v] = await db.query<{ id: string; version_no: number }>(
        `select v.id, v.version_no from submissions s join submission_versions v on v.submission_id = s.id
         where s.assignment_id = $1 and s.student_id = $2 order by v.version_no desc limit 1`,
        [assignment.id, st.id],
      );
      const items = v ? await reviewItemsFor(db, v.id) : [];
      const s = summarize(items);
      const ver = v
        ? (await db.query<{ answered: number; explained: number }>(
            `select count(answer)::int as answered, count(*) filter (where explained)::int as explained from verification_questions where submission_version_id = $1`,
            [v.id],
          ))[0]
        : { answered: 0, explained: 0 };
      const chats = (await db.query<{ n: number }>(`select count(*)::int as n from ai_chat_messages where assignment_id = $1 and student_id = $2 and role = 'student'`, [assignment.id, st.id]))[0].n;
      const group = insightGroup({
        verifiedCount: s.verified,
        average: s.average,
        returned: s.returned,
        passMark: rubric.pass_mark,
        verification: assignment.verification,
        answered: ver.answered,
        explained: ver.explained,
      });
      const evidence = [
        v ? `ส่งฉบับที่ ${v.version_no}` : 'ยังไม่ได้ส่งงาน',
        `ยืนยันแล้ว ${s.verified}/${s.total} ข้อ${s.average !== null ? ` · เฉลี่ย ${s.average.toFixed(2)}` : ''}`,
        ...(s.returned ? [`ส่งกลับให้แก้ ${s.returned} ข้อ`] : []),
        ...(assignment.verification ? [`ตอบคำถามตรวจความเข้าใจ ${ver.answered} ข้อ · อธิบายได้ ${ver.explained}`] : []),
        `ถาม AI ในแพลตฟอร์ม ${chats} ครั้ง`,
      ];
      out.push({ student: st, group, evidence, todo: INSIGHT_TODO[group] });
    }
    return {
      assignment: { id: assignment.id, title: assignment.title, verification: assignment.verification },
      groups: (Object.keys(INSIGHT_GROUPS) as InsightGroup[]).map((g) => ({ key: g, label: INSIGHT_GROUPS[g], students: out.filter((o) => o.group === g) })),
    };
  });
}

export { AppError };
