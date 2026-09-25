/** IDEAX domain logic shared by the teacher (Gate 1) and student (Gate 2) routes. */
import { gradeValue, INSIGHT_GROUPS, type InsightGroup, type ReviewItemStatus } from '@ideax/contracts';
import type { Queryable } from '../../db/index.js';
import type { Deps } from '../../app.js';
import { audit, trace } from '../../core/audit.js';
import { conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { actorOf, type UserRow } from '../../core/http.js';
import { fingerprint, newId, randomDigits } from '../../core/ids.js';
import { wordCount } from '../../core/text.js';

export interface AssignmentRow {
  id: string;
  course_id: string;
  rubric_id: string;
  title: string;
  brief: string;
  due_at: Date;
  min_words: number;
  max_words: number;
  requires_disclosure: boolean;
  verification: boolean;
  case_id: string | null;
}

export interface VersionCtx {
  version: { id: string; submission_id: string; version_no: number; content: string; sha256: string; word_count: number; receipt_id: string; received_at: Date; revision_note: string | null };
  submission: { id: string; assignment_id: string; student_id: string; status: string };
  assignment: AssignmentRow;
  course: { id: string; name: string; instructor_id: string };
  student: { id: string; name: string };
}

export async function getAssignment(q: Queryable, id: string): Promise<AssignmentRow> {
  const rows = await q.query<AssignmentRow>('select * from assignments where id = $1', [id]);
  if (!rows[0]) throw notFound('งานที่มอบหมาย');
  return rows[0];
}

export async function assertEnrolled(q: Queryable, courseId: string, userId: string) {
  const rows = await q.query('select 1 from enrollments where course_id = $1 and user_id = $2 and role = $3', [courseId, userId, 'student']);
  if (!rows.length) throw forbidden('คุณไม่ได้ลงทะเบียนในรายวิชานี้');
}

export async function loadVersion(q: Queryable, versionId: string): Promise<VersionCtx> {
  const rows = await q.query(
    `select row_to_json(v) as version, row_to_json(s) as submission, row_to_json(a) as assignment,
            json_build_object('id', c.id, 'name', c.name, 'instructor_id', c.instructor_id) as course,
            json_build_object('id', u.id, 'name', u.name) as student
     from submission_versions v
     join submissions s on s.id = v.submission_id
     join assignments a on a.id = s.assignment_id
     join courses c on c.id = a.course_id
     join users u on u.id = s.student_id
     where v.id = $1`,
    [versionId],
  );
  if (!rows[0]) throw notFound('ฉบับที่ส่ง');
  return rows[0] as VersionCtx;
}

/** Instructor of the course, or a marker enrolled in it. Release additionally needs the instructor. */
export async function assertReviewer(q: Queryable, user: UserRow, ctx: VersionCtx, opts: { release?: boolean } = {}) {
  if (user.role === 'thesis_mentor' && ctx.course.instructor_id === user.id) return;
  if (!opts.release && user.role === 'assistant_marker') {
    const rows = await q.query(`select 1 from enrollments where course_id = $1 and user_id = $2 and role = 'marker'`, [ctx.course.id, user.id]);
    if (rows.length) return;
  }
  throw forbidden(opts.release ? 'เฉพาะอาจารย์ผู้สอนเท่านั้นที่ปล่อยผลได้' : 'คุณไม่ได้เป็นผู้ตรวจของรายวิชานี้');
}

export async function latestVersion(q: Queryable, submissionId: string) {
  const rows = await q.query<{ id: string; version_no: number }>(
    'select id, version_no from submission_versions where submission_id = $1 order by version_no desc limit 1',
    [submissionId],
  );
  return rows[0] ?? null;
}

/* ───────────── submission (AC-01: receipt never waits for AI) ───────────── */

export async function submitVersion(
  deps: Deps,
  input: { student: UserRow; assignmentId: string; content: string; revisionNote?: string; cid: string },
) {
  const { db, clock, queue } = deps;
  const assignment = await getAssignment(db, input.assignmentId);
  await assertEnrolled(db, assignment.course_id, input.student.id);
  const now = clock.now();

  const existing = (await db.query<{ id: string; status: string }>(
    'select id, status from submissions where assignment_id = $1 and student_id = $2',
    [assignment.id, input.student.id],
  ))[0];
  if (existing && existing.status !== 'REVISION_REQUIRED') {
    throw conflict('NOT_OPEN_FOR_REVISION', existing.status === 'FINALIZED' ? 'งานนี้ปิดรอบแล้ว' : 'ส่งแล้ว รอผลตรวจก่อนจึงส่งฉบับใหม่ได้');
  }
  if (assignment.requires_disclosure) {
    const d = await db.query('select 1 from ai_disclosures where assignment_id = $1 and student_id = $2', [assignment.id, input.student.id]);
    if (!d.length) throw unprocessable('DISCLOSURE_REQUIRED', 'ต้องบันทึกคำชี้แจงการใช้ AI ก่อนส่ง');
  }
  const lastSubmitAt = existing
    ? (await db.query<{ at: Date }>('select max(received_at) as at from submission_versions where submission_id = $1', [existing.id]))[0].at
    : null;
  const pre = await db.query(
    'select 1 from precheck_runs where assignment_id = $1 and student_id = $2 and ($3::timestamptz is null or at > $3)',
    [assignment.id, input.student.id, lastSubmitAt],
  );
  if (!pre.length) throw unprocessable('PRECHECK_REQUIRED', 'ต้องกดตรวจความพร้อมก่อนส่ง (เป็นคำแนะนำ ไม่มีผลทางการ)');

  const versionId = newId('sv');
  const receiptId = `RCP-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomDigits(6)}`;
  const words = wordCount(input.content);
  const out = await db.tx(async (q) => {
    const submissionId = existing?.id ?? newId('sub');
    const prevStatus = existing?.status ?? 'DRAFT';
    const nextStatus = existing ? 'RESUBMITTED' : 'SUBMITTED';
    if (existing) await q.query('update submissions set status = $2 where id = $1', [existing.id, nextStatus]);
    else {
      await q.query('insert into submissions(id, assignment_id, student_id, status, created_at) values ($1, $2, $3, $4, $5)', [
        submissionId,
        assignment.id,
        input.student.id,
        nextStatus,
        now,
      ]);
    }
    const versionNo = existing ? ((await latestVersion(q, submissionId))?.version_no ?? 0) + 1 : 1;
    await q.query(
      `insert into submission_versions(id, submission_id, version_no, content, sha256, word_count, receipt_id, received_at, revision_note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [versionId, submissionId, versionNo, input.content, fingerprint(input.content), words, receiptId, now, input.revisionNote ?? null],
    );
    await q.query(
      `insert into analysis_runs(id, submission_version_id, status, created_at, updated_at) values ($1, $2, 'QUEUED', $3, $3)`,
      [newId('run'), versionId, now],
    );
    await audit(q, {
      cid: input.cid,
      actor: actorOf(input.student),
      object: `Submission · ${assignment.title}`,
      prev: prevStatus,
      next: nextStatus,
      reason: `receipt ${receiptId} · v${versionNo} · ${words} คำ · analysis=QUEUED`,
      at: now,
    });
    await trace(q, { cid: input.cid, actorId: input.student.id, type: 'submission.received', context: { kind: 'assignment', id: assignment.id }, payload: { versionNo, words, receiptId }, at: now });
    return { submissionId, versionNo };
  });
  // enqueue only after commit: the job must never see an uncommitted version
  queue.enqueue('ideax.analyze', { versionId }, input.cid);
  return {
    submissionId: out.submissionId,
    versionId,
    receipt: { id: receiptId, receivedAt: now.toISOString(), versionNo: out.versionNo, sha256: fingerprint(input.content), words },
    analysis: 'QUEUED' as const,
  };
}

/* ───────────── review maths (AC-04: equal weights when the rubric gives none) ───────────── */

export interface ItemForSummary {
  item_no: string;
  criterion_id: string;
  status: ReviewItemStatus;
  grade: string | null;
}

export function summarize(items: ItemForSummary[]) {
  const verified = items.filter((i) => i.status === 'VERIFIED' && gradeValue(i.grade) !== null);
  const avg = (list: ItemForSummary[]) => (list.length ? list.reduce((s, i) => s + (gradeValue(i.grade) ?? 0), 0) / list.length : null);
  const byCriterion: Record<string, number | null> = {};
  for (const cid of [...new Set(items.map((i) => i.criterion_id))]) byCriterion[cid] = avg(verified.filter((i) => i.criterion_id === cid));
  return {
    total: items.length,
    verified: verified.length,
    returned: items.filter((i) => i.status === 'RETURNED_FOR_REVISION').length,
    pending: items.filter((i) => i.status === 'AI_PROPOSED' || i.status === 'NO_PROPOSAL').length,
    average: avg(verified),
    byCriterion,
  };
}

export async function reviewItemsFor(q: Queryable, versionId: string) {
  return q.query<{
    id: string;
    item_no: string;
    status: ReviewItemStatus;
    grade: string | null;
    ai_grade: string | null;
    reason: string;
    ann: string[];
    row_version: number;
    criterion_id: string;
    text: string;
    position: number;
    kind: string | null;
    why: string | null;
    feedback: string | null;
    anchor_codes: string[] | null;
    reason_code: string | null;
    decided_by_name: string | null;
    decided_at: Date | null;
  }>(
    `select ri.*, it.criterion_id, it.text, it.position, p.kind, p.why, p.feedback, p.anchor_codes, p.reason_code, du.name as decided_by_name
     from review_items ri
     join submission_versions v on v.id = ri.submission_version_id
     join submissions s on s.id = v.submission_id
     join assignments a on a.id = s.assignment_id
     join rubric_items it on it.rubric_id = a.rubric_id and it.no = ri.item_no
     left join item_proposals p on p.submission_version_id = ri.submission_version_id and p.item_no = ri.item_no
     left join users du on du.id = ri.decided_by
     where ri.submission_version_id = $1
     order by it.position`,
    [versionId],
  );
}

/**
 * The learner-facing result. Contains only what a human confirmed; AI rationale (`why`)
 * and undecided proposals never leave the teacher's side (AC-12).
 */
export async function buildSnapshot(q: Queryable, ctx: VersionCtx, meta: { releasedBy: string; releasedAt: Date; mode: string; note: string }) {
  const [rubric] = await q.query('select * from rubrics where id = $1', [ctx.assignment.rubric_id]);
  const criteria = await q.query('select * from rubric_criteria where rubric_id = $1 order by position', [rubric.id]);
  const items = await reviewItemsFor(q, ctx.version.id);
  const anchors = await q.query<{ code: string; loc: string | null; start_offset: number; end_offset: number }>(
    'select code, loc, start_offset, end_offset from anchors where submission_version_id = $1',
    [ctx.version.id],
  );
  const anchorText = new Map(anchors.map((a) => [a.code, { loc: a.loc, text: ctx.version.content.slice(a.start_offset, a.end_offset) }]));
  const s = summarize(items);
  return {
    rubricId: rubric.id,
    rubricName: rubric.name,
    passMark: rubric.pass_mark,
    weighting: rubric.weights ? 'custom' : 'equal',
    assignmentTitle: ctx.assignment.title,
    versionNo: ctx.version.version_no,
    receiptId: ctx.version.receipt_id,
    releasedBy: meta.releasedBy,
    releasedAt: meta.releasedAt.toISOString(),
    mode: meta.mode,
    note: meta.note,
    average: s.average,
    counts: { verified: s.verified, returned: s.returned, total: s.total },
    criteria: criteria.map((c: any) => ({
      id: c.id,
      no: c.no,
      name: c.name,
      average: s.byCriterion[c.id] ?? null,
      items: items
        .filter((i) => i.criterion_id === c.id)
        .map((i) => ({
          no: i.item_no,
          text: i.text,
          status: i.status,
          grade: i.status === 'VERIFIED' ? i.grade : null,
          feedback: i.status === 'VERIFIED' ? (i.feedback ?? '') : '',
          teacherNote: i.reason || '',
          annotations: i.ann,
          evidence: i.status === 'VERIFIED' ? (i.anchor_codes ?? []).map((code) => anchorText.get(code)).filter(Boolean) : [],
        })),
    })),
  };
}

/* ───────────── insight groups (plan p.51) ───────────── */

export function insightGroup(input: {
  verifiedCount: number;
  average: number | null;
  returned: number;
  passMark: number;
  verification: boolean;
  answered: number;
  explained: number;
}): InsightGroup {
  if (input.verifiedCount === 0 || input.average === null) return 'insufficient';
  if (input.average < input.passMark || input.returned > 0) return 'needs_feedback';
  if (!input.verification) return 'understood';
  if (input.answered === 0) return 'insufficient';
  return input.explained === input.answered ? 'understood' : 'cannot_explain';
}

export const INSIGHT_TODO: Record<InsightGroup, { teacher: string; student: string }> = {
  understood: { teacher: 'ต่อยอดด้วยโจทย์ที่ยากขึ้น หรือชวนเป็นพี่เลี้ยง', student: 'ลองอธิบายงานให้เพื่อนฟัง แล้วเผยแพร่ผลงาน' },
  cannot_explain: { teacher: 'นัดคุยสั้น ๆ ให้อธิบายเหตุผลของงานตัวเอง', student: 'ตอบคำถามตรวจความเข้าใจอีกครั้งด้วยข้อมูลรองรับ' },
  needs_feedback: { teacher: 'ให้ Feedback เพิ่มในข้อที่ต่ำกว่าเส้นผ่านหรือส่งกลับให้แก้', student: 'แก้ตามข้อที่ถูกส่งกลับ แล้วส่งฉบับใหม่' },
  insufficient: { teacher: 'ยังตัดสินไม่ได้ ตรวจงานหรือรอคำตอบ verification ก่อน', student: 'ส่งงานให้ครบ และตอบคำถามตรวจความเข้าใจ' },
};

export { INSIGHT_GROUPS };
