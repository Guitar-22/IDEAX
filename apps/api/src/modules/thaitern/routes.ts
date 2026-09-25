/** Gate 2 (journey) · ผู้เรียน THAItern — steps 2–14 of the learner journey */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { CANVAS_SECTIONS, SME_GROUPS, STAGES, type AttemptState, type SupportLevel } from '@ideax/contracts';
import type { Deps } from '../../app.js';
import { AiUnavailableError } from '../../ai/provider.js';
import { audit, diag, trace } from '../../core/audit.js';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import { actorOf, parse, requireRole, requireUser, type UserRow } from '../../core/http.js';
import { newId, randomDigits } from '../../core/ids.js';
import { assertLearningConsents } from '../consent.js';
import { publicQuiz, QUIZ_PASS_PERCENT, scoreQuiz, SESSIONS } from './curriculum.js';
import { simulate, type FinanceParams } from './simulator.js';
import { openStages } from './stage.js';
import {
  ACTIVE_STATES,
  currentRound,
  deadlineFrom,
  getCase,
  issueCertificateIfReady,
  loadAttempt,
  newAccessCode,
  requireState,
  setState,
  stageStates,
  TEAM_MAX,
  teamMembers,
  type AttemptRow,
} from './service.js';

const FIRST_DRAFT_MINUTES = 30;
const ANOMALY_VIEWS_PER_MINUTE = 20;
const SECTION_KEYS = CANVAS_SECTIONS.map((s) => s.key) as [string, ...string[]];

const JOURNEY_STEP: Record<AttemptState, string> = {
  CHOSEN: '4a',
  FIRST_DRAFT: '4a',
  LEARNING: '4',
  READY_TO_UNLOCK: '5',
  IN_PROGRESS: '6',
  PUSHBACK: '8',
  FINALIZING: '9',
  SUBMITTED: '13',
  EVALUATED: '13',
  CREDENTIALED: '14',
  EXPIRED: '13',
};

interface CaseVersion {
  id: string;
  booklet: Array<{ title: string; body: string }>;
  data_room: Array<{ name: string; columns: string[]; rows: unknown[][]; note?: string }>;
  personas: Array<{ key: string; name: string; role: string; intro: string; facts: Array<{ keywords: string[]; answer: string }> }>;
  finance: FinanceParams;
  questions: Array<{ id: string; q: string }>;
  criteria: Array<{ key: string; name: string; stage: number; cues: string[] }>;
}

export function registerThaitern(app: FastifyInstance, deps: Deps) {
  const { db, clock, ai, queue, config } = deps;

  const caseVersion = async (id: string) => (await db.query<CaseVersion>('select * from case_versions where id = $1', [id]))[0];
  const learner = (req: any) => requireRole(req, 'learner');

  async function view(a: AttemptRow, u: UserRow) {
    const c = await getCase(db, a.case_id);
    const members = await teamMembers(db, a.team_id);
    const sessions = await db.query<{ session_key: string }>('select session_key from session_progress where attempt_id = $1', [a.id]);
    const states = await stageStates(db, u.id);
    const [sub] = await db.query('select id, receipt_id, received_at, status, ai_status, released_at from attempt_submissions where attempt_id = $1', [a.id]);
    const [lastPush] = await db.query('select round, section, challenge, defense, passed, why from pushback_rounds where attempt_id = $1 order by id desc limit 1', [a.id]);
    const cv = await caseVersion(a.case_version_id);
    const past = (s: AttemptState) => !['CHOSEN', 'FIRST_DRAFT', 'LEARNING', 'READY_TO_UNLOCK'].includes(s);
    const now = clock.now();
    return {
      id: a.id,
      state: a.state,
      journeyStep: JOURNEY_STEP[a.state],
      case: { id: c.id, title: c.title, teaser: c.teaser, track: c.track, industry: c.industry, subCategory: c.sub_category, stages: c.stages, status: c.status },
      challengeBrief: c.challenge_brief,
      team: { id: a.team_id, members: members.map((m) => ({ id: m.id, name: m.name, verified: m.student_card_verified })) },
      firstDraft: { text: a.first_draft, startedAt: a.first_draft_started_at, savedAt: a.first_draft_saved_at, minutes: FIRST_DRAFT_MINUTES },
      learning: { sessionsDone: sessions.map((s) => s.session_key), sessionsTotal: SESSIONS[c.track].length, quizScore: a.quiz_score, passPercent: QUIZ_PASS_PERCENT },
      unlock: {
        codeIssued: !!a.access_code,
        ...(config.devTools && a.access_code && a.state === 'READY_TO_UNLOCK' ? { devAccessCode: a.access_code } : {}),
        unlockedAt: a.unlocked_at,
        deadlineAt: a.deadline_at,
        msLeft: a.deadline_at ? new Date(a.deadline_at).getTime() - now.getTime() : null,
      },
      canvas: past(a.state) ? a.canvas : {},
      support: Object.fromEntries(c.stages.map((st) => [st, a.support_snapshot[u.id]?.[String(st)] ?? states[st].supportLevel])),
      pushback: { round: a.pushback_round, passedAt: a.pushback_passed_at, last: lastPush ?? null },
      questions: past(a.state) ? cv.questions : [],
      submission: sub ?? null,
      serverTime: now.toISOString(),
    };
  }

  /* ---------- steps 2–3 · explore without seeing the problem ---------- */

  app.get('/v1/catalog/filters', async () => {
    const rows = await db.query<{ track: string; sme_group: string | null; sub_category: string; province: string | null }>(
      `select distinct track, sme_group, sub_category, province from cases where status = 'PUBLISHED'`,
    );
    return { smeGroups: SME_GROUPS, options: rows };
  });

  app.get('/v1/catalog', async (req) => {
    requireUser(req);
    const f = parse(z.object({ track: z.enum(['sme', 'community']).optional(), group: z.string().optional(), province: z.string().optional() }), req.query);
    // TX-02: the teaser never reveals the real problem
    const rows = await db.query(
      `select c.id, c.track, c.sme_group, c.sub_category, c.industry, c.province, c.title, c.teaser, c.stages, o.name as org_name, rv.name as reviewed_by
       from cases c join organizations o on o.id = c.org_id left join users rv on rv.id = c.reviewed_by
       where c.status = 'PUBLISHED' and ($1::text is null or c.track = $1) and ($2::text is null or c.sme_group = $2) and ($3::text is null or c.province = $3)
       order by c.published_at desc nulls last, c.id`,
      [f.track ?? null, f.group ?? null, f.province ?? null],
    );
    return { cases: rows };
  });

  app.get('/v1/rounds/current', async () => currentRound(db, clock.now()));

  /* ---------- step 1 · teams of up to 4 (TX-06) ---------- */

  app.post('/v1/teams', async (req, reply) => {
    const u = learner(req);
    const { name } = parse(z.object({ name: z.string().min(1).max(80) }), req.body);
    const id = newId('team');
    await db.tx(async (q) => {
      await q.query('insert into teams(id, name, created_by) values ($1, $2, $3)', [id, name, u.id]);
      await q.query('insert into team_members(team_id, user_id, joined_at) values ($1, $2, $3)', [id, u.id, clock.now()]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Team · ${name}`, next: 'CREATED' });
    });
    return reply.status(201).send({ id, name });
  });

  app.post('/v1/teams/:id/members', async (req) => {
    const u = learner(req);
    const { id } = req.params as { id: string };
    const { userId } = parse(z.object({ userId: z.string() }), req.body);
    const [team] = await db.query<{ created_by: string; name: string }>('select * from teams where id = $1', [id]);
    if (!team) throw notFound('ทีม');
    if (team.created_by !== u.id) throw forbidden('เฉพาะผู้สร้างทีมเพิ่มสมาชิกได้');
    const members = await teamMembers(db, id);
    if (members.length >= TEAM_MAX) throw unprocessable('TEAM_FULL', `ทีมมีได้ไม่เกิน ${TEAM_MAX} คน`);
    const [target] = await db.query<UserRow>('select * from users where id = $1', [userId]);
    if (!target || target.role !== 'learner') throw notFound('ผู้เรียน');
    await db.query('insert into team_members(team_id, user_id, joined_at) values ($1, $2, $3) on conflict do nothing', [id, userId, clock.now()]);
    await audit(db, { cid: req.cid, actor: actorOf(u), object: `Team · ${team.name}`, next: `member+ ${target.name}` });
    return { members: await teamMembers(db, id) };
  });

  app.get('/v1/me/attempts', async (req) => {
    const u = learner(req);
    const rows = await db.query(
      `select a.id, a.state, a.deadline_at, a.created_at, c.id as case_id, c.title, c.track, c.industry
       from attempts a join team_members m on m.team_id = a.team_id join cases c on c.id = a.case_id
       where m.user_id = $1 order by a.created_at desc`,
      [u.id],
    );
    return { attempts: rows };
  });

  /** Step 3: choose exactly one place per round (TX-02). */
  app.post('/v1/attempts', async (req, reply) => {
    const u = learner(req);
    const body = parse(z.object({ caseId: z.string(), teamId: z.string().optional() }), req.body);
    const c = await getCase(db, body.caseId);
    if (c.status !== 'PUBLISHED') throw conflict('CASE_NOT_AVAILABLE', c.status === 'SUSPENDED' ? 'เจ้าของโจทย์ระงับการเปิดเคสนี้ชั่วคราว' : 'เคสนี้ยังไม่เปิดรับ');
    const round = await currentRound(db, clock.now());
    const now = clock.now();
    const out = await db.tx(async (q) => {
      let teamId = body.teamId;
      if (teamId) {
        const m = await q.query('select 1 from team_members where team_id = $1 and user_id = $2', [teamId, u.id]);
        if (!m.length) throw forbidden('คุณไม่ได้อยู่ในทีมนี้');
      }
      const memberIds = teamId ? (await teamMembers(q, teamId)).map((m) => m.id) : [u.id];
      const taken = await q.query<{ name: string; title: string }>(
        `select u.name, c.title from attempts a join team_members m on m.team_id = a.team_id join users u on u.id = m.user_id join cases c on c.id = a.case_id
         where a.round_id = $1 and m.user_id = any($2::text[]) and a.state <> 'EXPIRED'`,
        [round.id, memberIds],
      );
      if (taken.length) throw conflict('ALREADY_CHOSEN', `เลือกได้ 1 แห่งต่อรอบ · ${taken[0].name} เลือก “${taken[0].title}” ไปแล้ว`, { taken });
      if (!teamId) {
        teamId = newId('team');
        await q.query('insert into teams(id, name, created_by) values ($1, $2, $3)', [teamId, `${u.name} (เดี่ยว)`, u.id]);
        await q.query('insert into team_members(team_id, user_id, joined_at) values ($1, $2, $3) on conflict do nothing', [teamId, u.id, now]);
      }
      const [cv] = await q.query<{ id: string }>('select id from case_versions where case_id = $1 order by version_no desc limit 1', [c.id]);
      const id = newId('att');
      await q.query(
        `insert into attempts(id, round_id, team_id, case_id, case_version_id, state, created_by, created_at, updated_at) values ($1, $2, $3, $4, $5, 'CHOSEN', $6, $7, $7)`,
        [id, round.id, teamId, c.id, cv.id, u.id, now],
      );
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Attempt · ${c.title}`, prev: '-', next: 'CHOSEN', reason: `round=${round.id}` });
      await trace(q, { cid: req.cid, actorId: u.id, teamId, type: 'case.chosen', journeyStep: '3', context: { kind: 'attempt', id }, caseId: c.id, payload: { track: c.track, industry: c.industry } });
      return id;
    });
    const a = await loadAttempt(deps, out, u.id, req.cid);
    return reply.status(201).send(await view(a, u));
  });

  app.get('/v1/attempts/:id', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    return view(a, u);
  });

  /* ---------- step 4a · first draft before learning (Productive Failure) ---------- */

  app.post('/v1/attempts/:id/first-draft/start', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    requireState(a, ['CHOSEN', 'FIRST_DRAFT'], 'ร่างคำตอบแรก');
    if (!a.first_draft_started_at) {
      await db.query('update attempts set first_draft_started_at = $2, updated_at = $2 where id = $1', [a.id, clock.now()]);
      await trace(db, { cid: req.cid, actorId: u.id, type: 'draft.first.started', journeyStep: '4a', context: { kind: 'attempt', id: a.id }, caseId: a.case_id });
    }
    return view(await loadAttempt(deps, a.id, u.id, req.cid), u);
  });

  app.put('/v1/attempts/:id/first-draft', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    requireState(a, ['CHOSEN', 'FIRST_DRAFT'], 'ร่างคำตอบแรก');
    const { text, done } = parse(z.object({ text: z.string().max(8000), done: z.boolean().default(false) }), req.body);
    if (done && text.trim().length < 20) throw unprocessable('DRAFT_TOO_SHORT', 'เขียนร่างแรกอย่างน้อย 1–2 ประโยคก่อน ไม่ต้องถูกก็ได้');
    const now = clock.now();
    await db.tx(async (q) => {
      await q.query('update attempts set first_draft = $2, first_draft_saved_at = $3, first_draft_started_at = coalesce(first_draft_started_at, $3), updated_at = $3 where id = $1', [a.id, text, now]);
      await trace(q, { cid: req.cid, actorId: u.id, teamId: a.team_id, type: 'draft.first.saved', journeyStep: '4a', context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { chars: text.length, done } });
      if (a.state === 'CHOSEN') await setState(q, a, 'FIRST_DRAFT', { cid: req.cid, actor: actorOf(u), reason: 'first_draft_saved', now });
      if (done) await setState(q, a, 'LEARNING', { cid: req.cid, actor: actorOf(u), reason: 'first_draft_done · baseline for skill growth', now });
    });
    return view(await loadAttempt(deps, a.id, u.id, req.cid), u);
  });

  /* ---------- step 4 · sessions + quiz ≥ 80% ---------- */

  app.get('/v1/attempts/:id/sessions', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    const c = await getCase(db, a.case_id);
    const done = (await db.query<{ session_key: string }>('select session_key from session_progress where attempt_id = $1', [a.id])).map((r) => r.session_key);
    return { sessions: SESSIONS[c.track].map((s) => ({ ...s, done: done.includes(s.key) })), quiz: publicQuiz(c.track), passPercent: QUIZ_PASS_PERCENT, quizScore: a.quiz_score };
  });

  app.post('/v1/attempts/:id/sessions/:key/complete', async (req) => {
    const u = learner(req);
    const { id, key } = req.params as { id: string; key: string };
    const a = await loadAttempt(deps, id, u.id, req.cid);
    requireState(a, ['LEARNING'], 'เตรียมความรู้');
    const c = await getCase(db, a.case_id);
    if (!SESSIONS[c.track].some((s) => s.key === key)) throw notFound('เซสชัน');
    await db.query('insert into session_progress(attempt_id, session_key, completed_at) values ($1, $2, $3) on conflict do nothing', [a.id, key, clock.now()]);
    await trace(db, { cid: req.cid, actorId: u.id, type: 'session.completed', journeyStep: '4', context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { session: key } });
    return view(a, u);
  });

  app.post('/v1/attempts/:id/quiz', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    requireState(a, ['LEARNING'], 'แบบทดสอบ');
    const c = await getCase(db, a.case_id);
    const done = (await db.query('select 1 from session_progress where attempt_id = $1', [a.id])).length;
    if (done < SESSIONS[c.track].length) throw unprocessable('SESSIONS_INCOMPLETE', 'เรียนให้ครบทุกเซสชันก่อนทำแบบทดสอบ');
    const { answers } = parse(z.object({ answers: z.record(z.string(), z.number().int()) }), req.body);
    const score = scoreQuiz(c.track, answers);
    const passed = score >= QUIZ_PASS_PERCENT;
    const now = clock.now();
    await db.tx(async (q) => {
      await q.query('insert into quiz_attempts(attempt_id, user_id, answers, score, at) values ($1, $2, $3, $4, $5)', [a.id, u.id, JSON.stringify(answers), score, now]);
      await q.query('update attempts set quiz_score = greatest(coalesce(quiz_score, 0), $2), updated_at = $3 where id = $1', [a.id, score, now]);
      await trace(q, { cid: req.cid, actorId: u.id, type: 'quiz.scored', journeyStep: '4', context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { score, passed } });
      if (passed) {
        // the code travels by e-mail/SMS in production, like looking up exam results
        await q.query('update attempts set access_code = $2 where id = $1', [a.id, newAccessCode()]);
        await setState(q, a, 'READY_TO_UNLOCK', { cid: req.cid, actor: actorOf(u), reason: `quiz=${score}% ≥ ${QUIZ_PASS_PERCENT}% · access code issued`, now });
      }
    });
    return { score, passed, attempt: await view(await loadAttempt(deps, a.id, u.id, req.cid), u) };
  });

  /* ---------- step 5 · unlock the booklet, start the 14-day clock ---------- */

  app.post('/v1/attempts/:id/unlock', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    requireState(a, ['READY_TO_UNLOCK'], 'ปลดล็อก Case Booklet');
    const { code } = parse(z.object({ code: z.string().min(4) }), req.body);
    if (code.trim() !== a.access_code) throw unprocessable('ACCESS_CODE_INVALID', 'รหัสไม่ถูกต้อง');
    const c = await getCase(db, a.case_id);
    if (c.status !== 'PUBLISHED') throw conflict('CASE_NOT_AVAILABLE', 'เจ้าของโจทย์ระงับการเปิดเคสนี้ชั่วคราว (TX-15)');
    const members = await teamMembers(db, a.team_id);
    const unverified = members.filter((m) => !m.student_card_verified);
    if (unverified.length) throw unprocessable('IDENTITY_REQUIRED', 'สมาชิกทุกคนต้องยืนยันตัวตนด้วยบัตรนักศึกษาก่อนเปิดข้อมูลของเจ้าของโจทย์', { members: unverified.map((m) => m.name) });
    for (const m of members) {
      const [mu] = await db.query<UserRow>('select * from users where id = $1', [m.id]);
      await assertLearningConsents(db, mu, clock);
    }
    const now = clock.now();
    const snapshot: Record<string, Record<string, SupportLevel>> = {};
    for (const m of members) {
      const st = await stageStates(db, m.id);
      snapshot[m.id] = Object.fromEntries(c.stages.map((s) => [String(s), st[s].supportLevel]));
    }
    await db.tx(async (q) => {
      await q.query('update attempts set unlocked_at = $2, deadline_at = $3, support_snapshot = $4, updated_at = $2 where id = $1', [a.id, now, deadlineFrom(now), JSON.stringify(snapshot)]);
      await setState(q, a, 'IN_PROGRESS', { cid: req.cid, actor: actorOf(u), reason: `booklet unlocked · deadline ${deadlineFrom(now).toISOString()}`, now });
      await trace(q, { cid: req.cid, actorId: u.id, teamId: a.team_id, type: 'booklet.unlocked', journeyStep: '5', context: { kind: 'attempt', id: a.id }, caseId: a.case_id });
    });
    return view(await loadAttempt(deps, a.id, u.id, req.cid), u);
  });

  /* ---------- step 6 · booklet (web only, watermarked), data room, personas ---------- */

  const READABLE: AttemptState[] = [...ACTIVE_STATES, 'SUBMITTED'];

  app.get('/v1/attempts/:id/booklet', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    requireState(a, READABLE, 'อ่าน Case Booklet');
    const { page } = parse(z.object({ page: z.coerce.number().int().min(1).default(1) }), req.query);
    const cv = await caseVersion(a.case_version_id);
    const now = clock.now();
    await db.query('insert into booklet_views(attempt_id, user_id, page, at) values ($1, $2, $3, $4)', [a.id, u.id, page, now]);
    const [{ n }] = await db.query<{ n: number }>(`select count(*)::int as n from booklet_views where user_id = $1 and at > $2`, [u.id, new Date(now.getTime() - 60_000)]);
    if (n > ANOMALY_VIEWS_PER_MINUTE) {
      await trace(db, { cid: req.cid, actorId: u.id, type: 'booklet.access.anomaly', context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { viewsLastMinute: n } });
      await diag(db, { subjectKind: 'attempt', subjectId: a.id, kind: 'booklet_access_anomaly', detail: `${u.name} เปิด ${n} หน้าใน 1 นาที`, cid: req.cid });
    } else {
      await trace(db, { cid: req.cid, actorId: u.id, type: 'booklet.viewed', journeyStep: '6', context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { page } });
    }
    return {
      // rendered on the web only; no download URL exists (TX-05)
      watermark: `${u.name} · ${u.id} · ${now.toISOString().slice(0, 16).replace('T', ' ')}`,
      pages: cv.booklet,
      dataRoom: cv.data_room,
      personas: cv.personas.map(({ key, name, intro }) => ({ key, name, intro })),
      questions: cv.questions,
      finance: { unit: cv.finance.unit, basePrice: cv.finance.basePrice, baseHeadcount: cv.finance.baseHeadcount, baseMarketing: cv.finance.baseMarketing },
      deadlineAt: a.deadline_at,
    };
  });

  app.get('/v1/attempts/:id/personas/:key/messages', async (req) => {
    const u = learner(req);
    const { id, key } = req.params as { id: string; key: string };
    const a = await loadAttempt(deps, id, u.id, req.cid);
    const rows = await db.query('select role, text, at, user_id from persona_messages where attempt_id = $1 and persona_key = $2 order by id', [a.id, key]);
    return { messages: rows };
  });

  /** Stakeholder Chat, streamed as Server-Sent Events. The persona answers only from case facts. */
  app.post('/v1/attempts/:id/personas/:key/messages', async (req, reply: FastifyReply) => {
    const u = learner(req);
    const { id, key } = req.params as { id: string; key: string };
    const a = await loadAttempt(deps, id, u.id, req.cid);
    requireState(a, ACTIVE_STATES, 'Stakeholder Chat');
    const { text } = parse(z.object({ text: z.string().min(1).max(1000) }), req.body);
    const cv = await caseVersion(a.case_version_id);
    const persona = cv.personas.find((p) => p.key === key);
    if (!persona) throw notFound('ตัวละครในเคส');
    let answer: string;
    try {
      answer = await ai.personaReply({ persona, question: text });
    } catch (e) {
      if (e instanceof AiUnavailableError) throw new AppError(503, 'AI_UNAVAILABLE', 'ตัวละคร AI ไม่พร้อมชั่วคราว ลองใหม่อีกครั้ง ข้อมูลใน Booklet ยังอ่านได้ตามปกติ');
      throw e;
    }
    const now = clock.now();
    await db.tx(async (q) => {
      await q.query(`insert into persona_messages(attempt_id, persona_key, user_id, role, text, at) values ($1, $2, $3, 'learner', $4, $5), ($1, $2, null, 'persona', $6, $5)`, [a.id, key, u.id, text, now, answer]);
      await trace(q, { cid: req.cid, actorId: u.id, teamId: a.team_id, type: 'persona.asked', journeyStep: '6', stage: 4, context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { persona: key, question: text } });
    });
    reply.hijack();
    reply.raw.writeHead(200, { ...(reply.getHeaders() as Record<string, string>), 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const words = answer.split(/(\s+)/);
    for (let i = 0; i < words.length; i += 4) reply.raw.write(`event: token\ndata: ${JSON.stringify(words.slice(i, i + 4).join(''))}\n\n`);
    reply.raw.write(`event: done\ndata: ${JSON.stringify({ persona: persona.name })}\n\n`);
    reply.raw.end();
  });

  /* ---------- step 7 · Strategy Canvas: AI asks, never writes (TX-08) ---------- */

  app.put('/v1/attempts/:id/canvas/:section', async (req) => {
    const u = learner(req);
    const { id, section } = parse(z.object({ id: z.string(), section: z.enum(SECTION_KEYS) }), req.params);
    const a = await loadAttempt(deps, id, u.id, req.cid);
    requireState(a, ACTIVE_STATES, 'Strategy Canvas');
    const { text } = parse(z.object({ text: z.string().max(6000) }), req.body);
    await db.query(`update attempts set canvas = canvas || jsonb_build_object($2::text, $3::text), updated_at = $4 where id = $1`, [a.id, section, text, clock.now()]);
    const stage = CANVAS_SECTIONS.find((s) => s.key === section)!.stage;
    await trace(db, { cid: req.cid, actorId: u.id, teamId: a.team_id, type: 'canvas.section.saved', journeyStep: '7', stage, supportLevel: a.support_snapshot[u.id]?.[String(stage)] ?? null, context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { section, chars: text.length } });
    return { saved: true, section };
  });

  app.post('/v1/attempts/:id/canvas/:section/coach', async (req) => {
    const u = learner(req);
    const { id, section } = parse(z.object({ id: z.string(), section: z.enum(SECTION_KEYS) }), req.params);
    const a = await loadAttempt(deps, id, u.id, req.cid);
    requireState(a, ACTIVE_STATES, 'AI Coach');
    const text = a.canvas[section] ?? '';
    let out;
    try {
      out = await ai.coach({ section, text });
    } catch (e) {
      if (e instanceof AiUnavailableError) throw new AppError(503, 'AI_UNAVAILABLE', 'AI Coach ไม่พร้อมชั่วคราว คุณยังเขียน Canvas ต่อได้');
      throw e;
    }
    const stage = CANVAS_SECTIONS.find((s) => s.key === section)!.stage;
    // using the coach is support: the stage no longer counts as Solo for this learner
    await db.query(
      `update attempts set coach_hints = jsonb_set(coach_hints, array[$2::text], coalesce(coach_hints->$2, '{}'::jsonb) || jsonb_build_object($3::text, coalesce((coach_hints->$2->>$3)::int, 0) + 1), true) where id = $1`,
      [a.id, section, u.id],
    );
    await trace(db, { cid: req.cid, actorId: u.id, type: 'coach.hint.used', journeyStep: '7', stage, supportLevel: a.support_snapshot[u.id]?.[String(stage)] ?? null, context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { section, band: out.band } });
    return { questions: out.questions, missingEvidence: out.missingEvidence, band: out.band, proposed: true };
  });

  /* ---------- step 8 · Supervisor Pushback Loop ---------- */

  app.post('/v1/attempts/:id/pushback/start', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    requireState(a, ['IN_PROGRESS'], 'ถูกท้าทาย');
    const empty = SECTION_KEYS.filter((k) => !(a.canvas[k] ?? '').trim());
    if (empty.length) throw unprocessable('CANVAS_INCOMPLETE', 'กรอก Strategy Canvas ให้ครบ 5 ส่วนก่อนถูกท้าทาย', { empty });
    const ch = await ai.pushbackChallenge({ canvas: a.canvas, round: 1 }).catch((e) => {
      if (e instanceof AiUnavailableError) throw new AppError(503, 'AI_UNAVAILABLE', 'Senior Consultant AI ไม่พร้อมชั่วคราว');
      throw e;
    });
    const now = clock.now();
    await db.tx(async (q) => {
      await q.query('insert into pushback_rounds(attempt_id, round, section, challenge, at) values ($1, 1, $2, $3, $4)', [a.id, ch.section, ch.challenge, now]);
      await q.query('update attempts set pushback_round = 1 where id = $1', [a.id]);
      await setState(q, a, 'PUSHBACK', { cid: req.cid, actor: actorOf(u), reason: 'pushback started', now });
      await trace(q, { cid: req.cid, actorId: u.id, type: 'pushback.challenged', journeyStep: '8', stage: 5, context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { round: 1, section: ch.section } });
    });
    return view(await loadAttempt(deps, a.id, u.id, req.cid), u);
  });

  app.post('/v1/attempts/:id/pushback/respond', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    requireState(a, ['PUSHBACK'], 'ตอบข้อโต้แย้ง');
    const { defense } = parse(z.object({ defense: z.string().min(1).max(4000) }), req.body);
    const [last] = await db.query<{ id: number; round: number; section: string }>('select id, round, section from pushback_rounds where attempt_id = $1 order by id desc limit 1', [a.id]);
    const verdict = await ai.pushbackJudge({ section: last.section, defense }).catch((e) => {
      if (e instanceof AiUnavailableError) throw new AppError(503, 'AI_UNAVAILABLE', 'Senior Consultant AI ไม่พร้อมชั่วคราว คำตอบของคุณยังไม่ถูกบันทึก');
      throw e;
    });
    const now = clock.now();
    await db.tx(async (q) => {
      await q.query('update pushback_rounds set defense = $2, passed = $3, why = $4 where id = $1', [last.id, defense, verdict.passed, verdict.why]);
      await trace(q, { cid: req.cid, actorId: u.id, type: verdict.passed ? 'pushback.passed' : 'pushback.defended', journeyStep: '8', stage: 5, context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { round: last.round, passed: verdict.passed } });
      if (verdict.passed) {
        await q.query('update attempts set pushback_passed_at = $2 where id = $1', [a.id, now]);
        await setState(q, a, 'FINALIZING', { cid: req.cid, actor: actorOf(u), reason: `pushback passed in round ${last.round}`, now });
      } else {
        const next = await ai.pushbackChallenge({ canvas: a.canvas, round: last.round + 1 });
        await q.query('insert into pushback_rounds(attempt_id, round, section, challenge, at) values ($1, $2, $3, $4, $5)', [a.id, last.round + 1, next.section, next.challenge, now]);
        await q.query('update attempts set pushback_round = $2 where id = $1', [a.id, last.round + 1]);
      }
    });
    return { passed: verdict.passed, why: verdict.why, attempt: await view(await loadAttempt(deps, a.id, u.id, req.cid), u) };
  });

  /* ---------- step 9 · Financial Simulator (deterministic) ---------- */

  app.post('/v1/attempts/:id/simulate', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    requireState(a, ACTIVE_STATES, 'Financial Simulator');
    const inputs = parse(z.object({ price: z.number().positive().max(100000), marketing: z.number().min(0).max(10_000_000), headcount: z.number().int().min(1).max(200) }), req.body);
    const cv = await caseVersion(a.case_version_id);
    const outputs = simulate(cv.finance, inputs);
    const baseline = simulate(cv.finance, { price: cv.finance.basePrice, marketing: cv.finance.baseMarketing, headcount: cv.finance.baseHeadcount });
    await db.tx(async (q) => {
      await q.query('insert into simulations(attempt_id, user_id, inputs, outputs, at) values ($1, $2, $3, $4, $5)', [a.id, u.id, JSON.stringify(inputs), JSON.stringify(outputs), clock.now()]);
      await trace(q, { cid: req.cid, actorId: u.id, type: 'simulation.run', journeyStep: '9', stage: 6, context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { inputs, profit: outputs.profit } });
    });
    return { unit: cv.finance.unit, inputs, outputs, baseline };
  });

  /* ---------- step 12 · pre-submission reviewer (advisory) ---------- */

  app.post('/v1/attempts/:id/precheck', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    requireState(a, ACTIVE_STATES, 'AI ตรวจก่อนส่ง');
    const { answers } = parse(z.object({ answers: z.record(z.string(), z.string()).default({}) }), req.body ?? {});
    const cv = await caseVersion(a.case_version_id);
    const sims = (await db.query<{ n: number }>('select count(*)::int as n from simulations where attempt_id = $1', [a.id]))[0].n;
    const results: Array<{ level: 'ok' | 'attention' | 'question'; title: string; detail: string }> = [];
    const empty = SECTION_KEYS.filter((k) => !(a.canvas[k] ?? '').trim());
    results.push(empty.length ? { level: 'attention', title: 'Strategy Canvas ยังไม่ครบ', detail: `ยังว่าง: ${empty.join(', ')}` } : { level: 'ok', title: 'Strategy Canvas ครบ 5 ส่วน', detail: '' });
    results.push(/\d/.test(a.canvas.unit_economics ?? '') ? { level: 'ok', title: 'Unit Economics มีตัวเลข', detail: '' } : { level: 'attention', title: 'Unit Economics ยังไม่มีตัวเลขจาก Data Room', detail: 'เจ้าของโจทย์ต้องเห็นว่าข้อเสนอคุ้มหรือไม่' });
    results.push(a.pushback_passed_at ? { level: 'ok', title: 'ผ่านการท้าทายจาก Senior Consultant แล้ว', detail: '' } : { level: 'attention', title: 'ยังไม่ผ่านการท้าทาย', detail: 'ต้องผ่านขั้นที่ 8 ก่อนส่ง' });
    results.push(sims ? { level: 'ok', title: `ทดลองใน Financial Simulator แล้ว ${sims} ครั้ง`, detail: '' } : { level: 'question', title: 'ยังไม่ได้ลอง Financial Simulator', detail: 'ลองดูว่าข้อเสนอของคุณกระทบกำไรอย่างไร' });
    for (const qn of cv.questions) {
      const t = (answers[qn.id] ?? '').trim();
      results.push(t.length >= 40 ? { level: 'ok', title: `ตอบคำถามของเจ้าของโจทย์: ${qn.q}`, detail: '' } : { level: 'attention', title: `ยังตอบไม่ครบ: ${qn.q}`, detail: 'ตอบอย่างน้อย 2–3 ประโยคพร้อมเหตุผล' });
    }
    if (a.deadline_at) {
      const hrs = Math.floor((new Date(a.deadline_at).getTime() - clock.now().getTime()) / 3_600_000);
      results.push({ level: hrs < 24 ? 'attention' : 'ok', title: `เหลือเวลา ${Math.floor(hrs / 24)} วัน ${hrs % 24} ชั่วโมง`, detail: 'เวลาจากเซิร์ฟเวอร์' });
    }
    await trace(db, { cid: req.cid, actorId: u.id, type: 'precheck.run', journeyStep: '12', context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { attention: results.filter((r) => r.level !== 'ok').length } });
    return { results, advisory: true };
  });

  /* ---------- submit: receipt first, AI screening afterwards (AC-01, TX-04) ---------- */

  app.post('/v1/attempts/:id/submit', async (req, reply) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    requireState(a, ['FINALIZING'], 'ส่งงาน');
    const body = parse(z.object({ answers: z.record(z.string(), z.string().max(6000)), summary: z.string().min(1).max(6000) }), req.body);
    const cv = await caseVersion(a.case_version_id);
    const missing = cv.questions.filter((qn) => !(body.answers[qn.id] ?? '').trim()).map((qn) => qn.id);
    if (missing.length) throw unprocessable('ANSWERS_REQUIRED', 'ตอบคำถามของเจ้าของโจทย์ให้ครบก่อนส่ง', { missing });
    const now = clock.now();
    const id = newId('asub');
    const receiptId = `TXR-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomDigits(6)}`;
    await db.tx(async (q) => {
      await q.query(
        `insert into attempt_submissions(id, attempt_id, answers, summary, receipt_id, received_at, status) values ($1, $2, $3, $4, $5, $6, 'RECEIVED')`,
        [id, a.id, JSON.stringify(body.answers), body.summary, receiptId, now],
      );
      await setState(q, a, 'SUBMITTED', { cid: req.cid, actor: actorOf(u), reason: `receipt ${receiptId} · screening=QUEUED`, now });
      await trace(q, { cid: req.cid, actorId: u.id, teamId: a.team_id, type: 'submission.received', context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { receiptId } });
    });
    queue.enqueue('thaitern.score', { submissionId: id }, req.cid);
    return reply.status(201).send({ receipt: { id: receiptId, receivedAt: now.toISOString() }, screening: 'QUEUED' });
  });

  /* ---------- step 13 · feedback (released by humans only) ---------- */

  app.get('/v1/attempts/:id/feedback', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    const [s] = await db.query<any>('select * from attempt_submissions where attempt_id = $1', [a.id]);
    if (!s || s.status !== 'RELEASED') throw new AppError(404, 'NOT_RELEASED', 'ยังไม่มีผลที่กรรมการและเจ้าของโจทย์ปล่อย ผลคัดกรองของ AI จะไม่แสดงก่อนมนุษย์ยืนยัน');
    const cv = await caseVersion(a.case_version_id);
    await trace(db, { cid: req.cid, actorId: u.id, type: 'feedback.viewed', journeyStep: '13', context: { kind: 'attempt', id: a.id }, caseId: a.case_id });
    return {
      releasedAt: s.released_at,
      bands: (s.confirmed_bands ?? []).map((b: any) => ({ ...b, name: cv.criteria.find((c) => c.key === b.key)?.name ?? b.key })),
      judgeFeedback: s.judge_feedback,
      ownerFeedback: s.owner_feedback,
      smeChoice: s.sme_choice,
      certificateLevel: s.certificate_level,
    };
  });

  /* ---------- step 14 · understanding check, then certificate ---------- */

  app.get('/v1/attempts/:id/verification', async (req) => {
    const u = learner(req);
    const a = await loadAttempt(deps, (req.params as { id: string }).id, u.id, req.cid);
    const rows = await db.query('select position, question, answer, answered_at from attempt_verification where attempt_id = $1 and user_id = $2 order by position', [a.id, u.id]);
    const [cert] = await db.query('select level, verify_code, issued_at from certificates where attempt_id = $1 and user_id = $2', [a.id, u.id]);
    return { questions: rows, certificate: cert ?? null };
  });

  app.post('/v1/attempts/:id/verification/:position', async (req) => {
    const u = learner(req);
    const { id, position } = req.params as { id: string; position: string };
    const a = await loadAttempt(deps, id, u.id, req.cid);
    requireState(a, ['EVALUATED', 'CREDENTIALED'], 'ตอบคำถามตรวจความเข้าใจ');
    const { answer } = parse(z.object({ answer: z.string().min(1).max(4000) }), req.body);
    const [row] = await db.query<{ question: string; answer: string | null }>('select question, answer from attempt_verification where attempt_id = $1 and user_id = $2 and position = $3', [a.id, u.id, Number(position)]);
    if (!row) throw notFound('คำถาม');
    if (row.answer) throw unprocessable('ALREADY_ANSWERED', 'ตอบข้อนี้แล้ว');
    const judged = await ai.judgeExplanation({ question: row.question, answer }).catch(() => ({ explained: null, why: null }));
    await db.query('update attempt_verification set answer = $4, explained = $5, why = $6, answered_at = $7 where attempt_id = $1 and user_id = $2 and position = $3', [a.id, u.id, Number(position), answer, judged.explained, judged.why, clock.now()]);
    await trace(db, { cid: req.cid, actorId: u.id, type: 'verification.answered', journeyStep: '14', context: { kind: 'attempt', id: a.id }, caseId: a.case_id, payload: { position: Number(position) } });
    const cert = await issueCertificateIfReady(deps, a.id, u.id, req.cid);
    return { saved: true, certificate: cert ? { level: cert.level, verifyCode: cert.verify_code } : null };
  });

  app.get('/v1/me/stages', async (req) => {
    const u = learner(req);
    const s = await stageStates(db, u.id);
    const open = openStages(s);
    return { stages: STAGES.map((st) => ({ ...st, ...s[st.n], open: open.includes(st.n) })) };
  });

  app.get('/v1/me/certificates', async (req) => {
    const u = learner(req);
    const rows = await db.query(
      `select ce.id, ce.level, ce.verify_code, ce.issued_at, c.title, c.track, a.id as attempt_id
       from certificates ce join attempts a on a.id = ce.attempt_id join cases c on c.id = a.case_id where ce.user_id = $1 order by ce.issued_at desc`,
      [u.id],
    );
    return { certificates: rows };
  });

  /** Anyone can verify a certificate code; it reveals only name, case title, level and date. */
  app.get('/v1/public/certificates/:code', async (req) => {
    const { code } = req.params as { code: string };
    const [row] = await db.query(
      `select ce.level, ce.issued_at, u.name, c.title from certificates ce join users u on u.id = ce.user_id join attempts a on a.id = ce.attempt_id join cases c on c.id = a.case_id where ce.verify_code = $1`,
      [code],
    );
    if (!row) throw notFound('ใบรับรอง');
    return row;
  });
}
