/** Gate 2 (coursework) · นักศึกษา — tasks, precheck, AI disclosure, submit, feedback, revise, verification */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DisclosureBody, SubmitBody } from '@ideax/contracts';
import type { Deps } from '../../app.js';
import type { ItemHints } from '../../ai/provider.js';
import { AiUnavailableError } from '../../ai/provider.js';
import { audit, trace } from '../../core/audit.js';
import { AppError, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { actorOf, parse, requireRole } from '../../core/http.js';
import { fingerprint } from '../../core/ids.js';
import { wordCount } from '../../core/text.js';
import { assertEnrolled, getAssignment, latestVersion, submitVersion } from './service.js';

type PrecheckLevel = 'ok' | 'attention' | 'question';

export function registerStudent(app: FastifyInstance, deps: Deps) {
  const { db, clock, ai } = deps;

  async function mySubmission(assignmentId: string, studentId: string) {
    const rows = await db.query<{ id: string; status: string }>('select id, status from submissions where assignment_id = $1 and student_id = $2', [assignmentId, studentId]);
    return rows[0] ?? null;
  }

  async function ownSubmission(submissionId: string, studentId: string) {
    const rows = await db.query<{ id: string; status: string; assignment_id: string; student_id: string }>('select * from submissions where id = $1', [submissionId]);
    if (!rows[0]) throw notFound('งานที่ส่ง');
    if (rows[0].student_id !== studentId) throw forbidden('นี่ไม่ใช่งานของคุณ');
    return rows[0];
  }

  /** Only the learner's own enrollments, ordered by due date, server time (Gate 2 step 1). */
  app.get('/v1/me/tasks', async (req) => {
    const u = requireRole(req, 'learner');
    const rows = await db.query(
      `select a.id, a.title, a.due_at, a.verification, c.name as course_name, s.id as submission_id, s.status,
              (select max(version_no) from submission_versions v where v.submission_id = s.id) as versions,
              exists (select 1 from feedback_releases f join submission_versions v on v.id = f.submission_version_id where v.submission_id = s.id) as has_feedback
       from enrollments e
       join courses c on c.id = e.course_id
       join assignments a on a.course_id = c.id
       left join submissions s on s.assignment_id = a.id and s.student_id = e.user_id
       where e.user_id = $1 and e.role = 'student'
       order by a.due_at`,
      [u.id],
    );
    return { serverTime: clock.now().toISOString(), tasks: rows };
  });

  app.get('/v1/assignments/:id', async (req) => {
    const u = requireRole(req, 'learner');
    const a = await getAssignment(db, (req.params as { id: string }).id);
    await assertEnrolled(db, a.course_id, u.id);
    const [rubric] = await db.query('select id, name, pass_mark, weights, source from rubrics where id = $1', [a.rubric_id]);
    const criteria = await db.query(
      `select c.id, c.no, c.name, c.th,
              (select json_agg(json_build_object('no', i.no, 'text', i.text) order by i.position) from rubric_items i where i.criterion_id = c.id) as items
       from rubric_criteria c where c.rubric_id = $1 order by c.position`,
      [a.rubric_id],
    );
    const [course] = await db.query('select id, name from courses where id = $1', [a.course_id]);
    const disclosure = (await db.query('select tool, part, at from ai_disclosures where assignment_id = $1 and student_id = $2 order by at desc limit 1', [a.id, u.id]))[0] ?? null;
    const sub = await mySubmission(a.id, u.id);
    const versions = sub
      ? await db.query(
          `select v.id, v.version_no, v.receipt_id, v.received_at, v.word_count, v.sha256,
                  (select status from analysis_runs r where r.submission_version_id = v.id order by created_at desc limit 1) as analysis
           from submission_versions v where v.submission_id = $1 order by v.version_no`,
          [sub.id],
        )
      : [];
    const lastAt = versions.length ? versions[versions.length - 1].received_at : null;
    const pre = (await db.query('select result, at from precheck_runs where assignment_id = $1 and student_id = $2 and ($3::timestamptz is null or at > $3) order by at desc limit 1', [a.id, u.id, lastAt]))[0] ?? null;
    const lastContent = sub && versions.length ? (await db.query<{ content: string }>('select content from submission_versions where id = $1', [versions[versions.length - 1].id]))[0].content : null;
    return {
      serverTime: clock.now().toISOString(),
      assignment: { id: a.id, title: a.title, brief: a.brief, dueAt: a.due_at, minWords: a.min_words, maxWords: a.max_words, requiresDisclosure: a.requires_disclosure, verification: a.verification },
      course,
      rubric: { id: rubric.id, name: rubric.name, passMark: rubric.pass_mark, weighting: rubric.weights ? 'custom' : 'equal', source: rubric.source, criteria },
      disclosure,
      submission: sub ? { ...sub, versions } : null,
      lastContent,
      precheck: pre,
      canSubmit: !sub || sub.status === 'REVISION_REQUIRED',
    };
  });

  /** Advisory only: no official effect, never edits the file, never a readiness percentage. */
  app.post('/v1/assignments/:id/precheck', async (req) => {
    const u = requireRole(req, 'learner');
    const a = await getAssignment(db, (req.params as { id: string }).id);
    await assertEnrolled(db, a.course_id, u.id);
    const { content } = parse(z.object({ content: z.string().min(1) }), req.body);
    const words = wordCount(content);
    const results: Array<{ level: PrecheckLevel; title: string; detail: string; item?: string }> = [];
    results.push(
      words >= a.min_words && words <= a.max_words
        ? { level: 'ok', title: 'ความยาวอยู่ในช่วงที่กำหนด', detail: `${words.toLocaleString('en-US')} คำ · ช่วงที่กำหนด ${a.min_words.toLocaleString('en-US')}–${a.max_words.toLocaleString('en-US')} คำ` }
        : { level: 'attention', title: 'ความยาวยังไม่อยู่ในช่วงที่กำหนด', detail: `${words.toLocaleString('en-US')} คำ · ช่วงที่กำหนด ${a.min_words.toLocaleString('en-US')}–${a.max_words.toLocaleString('en-US')} คำ` },
    );
    const items = await db.query<{ no: string; text: string; hints: ItemHints }>(
      `select no, text, hints from rubric_items where rubric_id = $1 and (hints->>'precheck')::boolean is true order by position`,
      [a.rubric_id],
    );
    try {
      const proposals = await ai.analyzeSubmission({ content, items });
      for (const p of proposals) {
        const it = items.find((i) => i.no === p.itemNo)!;
        if (p.kind === 'presence') results.push({ level: 'ok', item: p.itemNo, title: `พบข้อความที่ตรงกับเกณฑ์ข้อ ${p.itemNo}`, detail: p.why });
        else if (p.kind === 'absence') results.push({ level: 'attention', item: p.itemNo, title: `ยังไม่พบส่วนที่ตอบเกณฑ์ข้อ ${p.itemNo}`, detail: it.hints.fbAbsent ?? it.text });
        else if (p.kind === 'unreadable') results.push({ level: 'attention', item: p.itemNo, title: 'มีภาพที่ระบบอ่านไม่ได้', detail: `${p.why} ถ้าแปลงเป็นตารางข้อความ ระบบจะช่วยตรวจข้อ ${p.itemNo} ได้` });
        else results.push({ level: 'question', item: p.itemNo, title: `เกณฑ์ข้อ ${p.itemNo} อาจต้องใช้เอกสารเพิ่ม`, detail: p.why });
      }
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) throw e;
      results.push({ level: 'question', title: 'ระบบช่วยตรวจไม่พร้อมชั่วคราว', detail: 'ตรวจได้เฉพาะจำนวนคำ คุณยังส่งงานได้ตามปกติ' });
    }
    if (a.requires_disclosure) {
      const d = await db.query('select 1 from ai_disclosures where assignment_id = $1 and student_id = $2', [a.id, u.id]);
      if (!d.length) results.push({ level: 'question', title: 'ยังไม่ได้กรอกการใช้ AI', detail: 'งานนี้กำหนดให้ระบุเครื่องมือที่ใช้และส่วนที่คุณตรวจทานเอง' });
    }
    const at = clock.now();
    await db.tx(async (q) => {
      await q.query('insert into precheck_runs(assignment_id, student_id, content_hash, result, at) values ($1, $2, $3, $4, $5)', [a.id, u.id, fingerprint(content), JSON.stringify(results), at]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Precheck · ${a.title}`, next: 'ADVISORY_ONLY', reason: `no official effect · word_count=${words}` });
      await trace(q, { cid: req.cid, actorId: u.id, type: 'precheck.run', journeyStep: '12', context: { kind: 'assignment', id: a.id }, payload: { words, attention: results.filter((r) => r.level !== 'ok').length } });
    });
    return { words, results, at: at.toISOString(), advisory: true };
  });

  app.put('/v1/assignments/:id/disclosure', async (req) => {
    const u = requireRole(req, 'learner');
    const a = await getAssignment(db, (req.params as { id: string }).id);
    await assertEnrolled(db, a.course_id, u.id);
    const body = parse(DisclosureBody, req.body);
    await db.tx(async (q) => {
      await q.query('insert into ai_disclosures(assignment_id, student_id, tool, part, at) values ($1, $2, $3, $4, $5)', [a.id, u.id, body.tool, body.part, clock.now()]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `AI disclosure · ${a.title}`, next: 'DECLARED', reason: `tool=${body.tool}` });
    });
    return { ok: true };
  });

  app.post('/v1/assignments/:id/submissions', async (req, reply) => {
    const u = requireRole(req, 'learner');
    const body = parse(SubmitBody, req.body);
    const out = await submitVersion(deps, { student: u, assignmentId: (req.params as { id: string }).id, content: body.content, cid: req.cid });
    return reply.status(201).send(out);
  });

  app.post('/v1/submissions/:id/versions', async (req, reply) => {
    const u = requireRole(req, 'learner');
    const sub = await ownSubmission((req.params as { id: string }).id, u.id);
    const body = parse(SubmitBody, req.body);
    const out = await submitVersion(deps, { student: u, assignmentId: sub.assignment_id, content: body.content, revisionNote: body.revisionNote, cid: req.cid });
    return reply.status(201).send(out);
  });

  app.get('/v1/submissions/:id', async (req) => {
    const u = requireRole(req, 'learner');
    const sub = await ownSubmission((req.params as { id: string }).id, u.id);
    const versions = await db.query(
      `select v.id, v.version_no, v.receipt_id, v.received_at, v.word_count, v.sha256, v.revision_note,
              (select status from analysis_runs r where r.submission_version_id = v.id order by created_at desc limit 1) as analysis,
              exists (select 1 from feedback_releases f where f.submission_version_id = v.id) as released
       from submission_versions v where v.submission_id = $1 order by v.version_no`,
      [sub.id],
    );
    const [a] = await db.query('select id, title from assignments where id = $1', [sub.assignment_id]);
    return { submission: { id: sub.id, status: sub.status }, assignment: a, versions, serverTime: clock.now().toISOString() };
  });

  /** Only what the teacher released (AC-12). AI proposals are never visible here. */
  app.get('/v1/submissions/:id/feedback', async (req) => {
    const u = requireRole(req, 'learner');
    const sub = await ownSubmission((req.params as { id: string }).id, u.id);
    const rows = await db.query<{ snapshot: any; released_at: Date; mode: string }>(
      `select f.snapshot, f.released_at, f.mode from feedback_releases f
       join submission_versions v on v.id = f.submission_version_id
       where v.submission_id = $1 order by v.version_no desc, f.release_version desc limit 1`,
      [sub.id],
    );
    if (!rows[0]) throw new AppError(404, 'NOT_RELEASED', 'ยังไม่มีผลที่อาจารย์ปล่อย ข้อเสนอของ AI จะไม่แสดงให้ผู้เรียนเห็นก่อนอาจารย์ยืนยัน');
    await trace(db, { cid: req.cid, actorId: u.id, type: 'feedback.viewed', journeyStep: '13', context: { kind: 'submission', id: sub.id } });
    return { status: sub.status, ...rows[0].snapshot };
  });

  /* ---------- verification mode: understanding questions generated from the learner's own work ---------- */
  app.get('/v1/assignments/:id/verification', async (req) => {
    const u = requireRole(req, 'learner');
    const a = await getAssignment(db, (req.params as { id: string }).id);
    const sub = await mySubmission(a.id, u.id);
    if (!sub) return { questions: [] };
    const v = await latestVersion(db, sub.id);
    const questions = await db.query('select position, question, answer, answered_at from verification_questions where submission_version_id = $1 order by position', [v!.id]);
    return { versionNo: v!.version_no, questions };
  });

  app.post('/v1/assignments/:id/verification/:position', async (req) => {
    const u = requireRole(req, 'learner');
    const { id, position } = req.params as { id: string; position: string };
    const { answer } = parse(z.object({ answer: z.string().min(1).max(4000) }), req.body);
    const sub = await mySubmission(id, u.id);
    if (!sub) throw notFound('งานที่ส่ง');
    const v = await latestVersion(db, sub.id);
    const [q0] = await db.query<{ question: string; answer: string | null }>('select question, answer from verification_questions where submission_version_id = $1 and position = $2', [v!.id, Number(position)]);
    if (!q0) throw notFound('คำถาม');
    if (q0.answer) throw unprocessable('ALREADY_ANSWERED', 'ตอบข้อนี้แล้ว');
    let judged: { explained: boolean | null; why: string | null } = { explained: null, why: null };
    try {
      judged = await ai.judgeExplanation({ question: q0.question, answer });
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) throw e;
    }
    await db.tx(async (q) => {
      await q.query('update verification_questions set answer = $3, explained = $4, why = $5, answered_at = $6 where submission_version_id = $1 and position = $2', [v!.id, Number(position), answer, judged.explained, judged.why, clock.now()]);
      await trace(q, { cid: req.cid, actorId: u.id, type: 'verification.answered', context: { kind: 'assignment', id }, payload: { position: Number(position), explained: judged.explained } });
    });
    // the AI judgement is a proposal for the teacher; the learner only sees that the answer is saved
    return { saved: true };
  });

  /** Paste/focus events from verification mode: recorded, never penalised automatically (TX-20). */
  app.post('/v1/assignments/:id/integrity-events', async (req) => {
    const u = requireRole(req, 'learner');
    const { type } = parse(z.object({ type: z.enum(['paste.blocked', 'focus.lost']) }), req.body);
    await trace(db, { cid: req.cid, actorId: u.id, type, context: { kind: 'assignment', id: (req.params as { id: string }).id } });
    return { recorded: true };
  });

  /* ---------- AI inside the platform: Socratic, asks back, never writes the work (TX-08, TX-19) ---------- */
  app.get('/v1/assignments/:id/ai-chat', async (req) => {
    const u = requireRole(req, 'learner');
    const rows = await db.query('select role, text, at from ai_chat_messages where assignment_id = $1 and student_id = $2 order by id', [(req.params as { id: string }).id, u.id]);
    return { messages: rows };
  });

  app.post('/v1/assignments/:id/ai-chat', async (req) => {
    const u = requireRole(req, 'learner');
    const a = await getAssignment(db, (req.params as { id: string }).id);
    await assertEnrolled(db, a.course_id, u.id);
    const { text } = parse(z.object({ text: z.string().min(1).max(4000) }), req.body);
    let reply: string;
    try {
      const c = await ai.coach({ section: 'problem', text });
      reply = c.questions.join('\n');
    } catch (e) {
      if (e instanceof AiUnavailableError) throw new AppError(503, 'AI_UNAVAILABLE', 'ผู้ช่วย AI ไม่พร้อมชั่วคราว งานและร่างของคุณยังอยู่ครบ');
      throw e;
    }
    const now = clock.now();
    await db.tx(async (q) => {
      await q.query(`insert into ai_chat_messages(assignment_id, student_id, role, text, at) values ($1, $2, 'student', $3, $4), ($1, $2, 'ai', $5, $4)`, [a.id, u.id, text, now, reply]);
      await trace(q, { cid: req.cid, actorId: u.id, type: 'ai.prompt', context: { kind: 'assignment', id: a.id }, payload: { chars: text.length } });
    });
    return { reply };
  });
}
