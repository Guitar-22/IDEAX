/** THAItern journey: state machine guards and shared helpers (docs/APP_FLOW.md §7, §12). */
import { PASS_BAND, type AttemptState, type SupportLevel } from '@ideax/contracts';
import type { Deps } from '../../app.js';
import type { Queryable } from '../../db/index.js';
import { audit, trace } from '../../core/audit.js';
import { DAY } from '../../core/clock.js';
import { conflict, forbidden, notFound, unprocessable } from '../../core/errors.js';
import type { Actor } from '../../core/audit.js';
import { newId, randomDigits } from '../../core/ids.js';
import { applyStageResult, INITIAL_STAGE, type StageState } from './stage.js';

export const SUBMIT_WINDOW_DAYS = 14;
export const TEAM_MAX = 4;
export const ACTIVE_STATES: AttemptState[] = ['IN_PROGRESS', 'PUSHBACK', 'FINALIZING'];
/** canvas section → stage it trains (contracts CANVAS_SECTIONS) */
export const SECTION_STAGE: Record<string, number> = { problem: 1, target: 4, unit_economics: 3, channels: 5, risks: 5 };

export interface AttemptRow {
  id: string;
  round_id: string;
  team_id: string;
  case_id: string;
  case_version_id: string;
  state: AttemptState;
  first_draft: string | null;
  first_draft_started_at: Date | null;
  first_draft_saved_at: Date | null;
  quiz_score: number | null;
  access_code: string | null;
  unlocked_at: Date | null;
  deadline_at: Date | null;
  support_snapshot: Record<string, Record<string, SupportLevel>>;
  canvas: Record<string, string>;
  coach_hints: Record<string, Record<string, number>>;
  pushback_round: number;
  pushback_passed_at: Date | null;
  created_by: string;
}

export interface CaseRow {
  id: string;
  org_id: string;
  track: 'sme' | 'community';
  sme_group: string | null;
  sub_category: string;
  industry: string;
  province: string | null;
  title: string;
  teaser: string;
  challenge_brief: string;
  status: string;
  stages: number[];
  mask_terms: string[];
  reviewed_by: string | null;
}

export async function currentRound(q: Queryable, now: Date) {
  const rows = await q.query<{ id: string; name: string; ends_at: Date }>(
    'select * from rounds where starts_at <= $1 and ends_at > $1 order by starts_at desc limit 1',
    [now],
  );
  if (!rows[0]) throw unprocessable('NO_OPEN_ROUND', 'ตอนนี้ยังไม่มีรอบที่เปิดรับ');
  return rows[0];
}

export async function getCase(q: Queryable, id: string): Promise<CaseRow> {
  const rows = await q.query<CaseRow>('select * from cases where id = $1', [id]);
  if (!rows[0]) throw notFound('เคส');
  return rows[0];
}

export async function teamMembers(q: Queryable, teamId: string) {
  return q.query<{ id: string; name: string; student_card_verified: boolean; birth_year: number | null }>(
    'select u.id, u.name, u.student_card_verified, u.birth_year from team_members m join users u on u.id = m.user_id where m.team_id = $1 order by m.joined_at',
    [teamId],
  );
}

/** Loads an attempt the user belongs to, and applies the 14-day deadline lazily (TX-04). */
export async function loadAttempt(deps: Deps, attemptId: string, userId: string, cid: string): Promise<AttemptRow> {
  const { db, clock } = deps;
  const rows = await db.query<AttemptRow>('select * from attempts where id = $1', [attemptId]);
  const a = rows[0];
  if (!a) throw notFound('เคสที่กำลังทำ');
  const member = await db.query('select 1 from team_members where team_id = $1 and user_id = $2', [a.team_id, userId]);
  if (!member.length) throw forbidden('คุณไม่ได้อยู่ในทีมนี้');
  if (ACTIVE_STATES.includes(a.state) && a.deadline_at && clock.now() > new Date(a.deadline_at)) {
    await db.tx(async (q) => {
      await q.query(`update attempts set state = 'EXPIRED', updated_at = $2 where id = $1`, [a.id, clock.now()]);
      await audit(q, { cid, actor: null, object: `Attempt · ${a.id}`, prev: a.state, next: 'EXPIRED', reason: `เลยกำหนดส่ง ${new Date(a.deadline_at!).toISOString()} · TX-04` });
    });
    a.state = 'EXPIRED';
  }
  return a;
}

export function requireState(a: AttemptRow, allowed: AttemptState[], what: string) {
  if (!allowed.includes(a.state)) {
    const expired = a.state === 'EXPIRED';
    throw conflict(expired ? 'DEADLINE_PASSED' : 'WRONG_STEP', expired ? 'เลยกำหนดส่ง 14 วันแล้ว' : `ยังทำขั้น “${what}” ไม่ได้ในสถานะ ${a.state}`, { state: a.state, allowed });
  }
}

export async function setState(q: Queryable, a: AttemptRow, next: AttemptState, e: { cid: string; actor: Actor | null; reason: string; now: Date }) {
  await q.query('update attempts set state = $2, updated_at = $3 where id = $1', [a.id, next, e.now]);
  await audit(q, { cid: e.cid, actor: e.actor, object: `Attempt · ${a.id}`, prev: a.state, next, reason: e.reason, at: e.now });
  a.state = next;
}

export async function stageStates(q: Queryable, userId: string): Promise<Record<number, StageState>> {
  const rows = await q.query<{ stage: number; support_level: SupportLevel; consecutive_solo: number; last_solo_industry: string | null; mastered: boolean }>(
    'select * from stage_progress where user_id = $1',
    [userId],
  );
  const out: Record<number, StageState> = {};
  for (let n = 1; n <= 7; n++) out[n] = { ...INITIAL_STAGE };
  for (const r of rows) out[r.stage] = { supportLevel: r.support_level, consecutiveSolo: r.consecutive_solo, lastSoloIndustry: r.last_solo_industry, mastered: r.mastered };
  return out;
}

export function newAccessCode(): string {
  return `TX-${randomDigits(4)}-${randomDigits(4)}`;
}

export function deadlineFrom(now: Date): Date {
  return new Date(now.getTime() + SUBMIT_WINDOW_DAYS * DAY);
}

/**
 * Human release of a case round (Gate 3 judge). Everything below happens because a person decided:
 * attempts become EVALUATED, stage progress moves (TX-01), certificate level is fixed, and each
 * member gets understanding questions to answer before the certificate is issued.
 */
export async function releaseCaseRound(deps: Deps, input: { caseId: string; judge: Actor; cid: string }) {
  const { db, clock, ai } = deps;
  const c = await getCase(db, input.caseId);
  const subs = await db.query<{ id: string; attempt_id: string; confirmed_bands: Array<{ key: string; band: number; stage: number }> | null; sme_choice: boolean; status: string; answers: Record<string, string>; summary: string }>(
    `select s.* from attempt_submissions s join attempts a on a.id = s.attempt_id where a.case_id = $1 and s.status in ('RECEIVED', 'SCREENED', 'CONFIRMED')`,
    [c.id],
  );
  const unconfirmed = subs.filter((s) => s.status !== 'CONFIRMED').map((s) => s.id);
  if (unconfirmed.length) throw unprocessable('NOT_ALL_CONFIRMED', `ยังมี ${unconfirmed.length} ผลงานที่กรรมการยังไม่ยืนยันผล · ทุกทีมต้องได้ Feedback (TX-10)`, { unconfirmed });
  if (!subs.length) throw unprocessable('NOTHING_TO_RELEASE', 'ยังไม่มีผลงานที่ยืนยันแล้วในเคสนี้');
  const now = clock.now();
  const released: string[] = [];
  for (const s of subs) {
    const [a] = await db.query<AttemptRow>('select * from attempts where id = $1', [s.attempt_id]);
    const bands = s.confirmed_bands ?? [];
    const allPass = bands.length > 0 && bands.every((b) => b.band >= PASS_BAND);
    const level = s.sme_choice ? 'sme_choice' : allPass ? 'merit' : 'participation';
    const members = await teamMembers(db, a.team_id);
    const questions = await ai.verificationQuestions([s.summary, ...Object.values(s.answers)].join('\n')).catch(() => [
      'อธิบายด้วยคำพูดของคุณเองว่าทำไมจึงเลือกแนวทางนี้ ข้อมูลอะไรสนับสนุน และถ้าเงื่อนไขเปลี่ยนจะตัดสินใจอย่างไร',
    ]);
    await db.tx(async (q) => {
      await q.query(`update attempt_submissions set status = 'RELEASED', released_at = $2, certificate_level = $3 where id = $1`, [s.id, now, level]);
      await setState(q, a, 'EVALUATED', { cid: input.cid, actor: input.judge, reason: `feedback_released · certificate=${level}`, now });
      for (const m of members) {
        const states = await stageStates(q, m.id);
        for (const b of bands) {
          const snapshot = a.support_snapshot[m.id] ?? {};
          const sections = Object.entries(SECTION_STAGE).filter(([, st]) => st === b.stage).map(([sec]) => sec);
          const hints = sections.reduce((n, sec) => n + (a.coach_hints[sec]?.[m.id] ?? 0), 0);
          const solo = snapshot[String(b.stage)] === 'SOLO' && hints === 0;
          const next = applyStageResult(states[b.stage], { solo, passed: b.band >= PASS_BAND, industry: c.industry });
          await q.query(
            `insert into stage_progress(user_id, stage, support_level, consecutive_solo, last_solo_industry, mastered, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (user_id, stage) do update set support_level = $3, consecutive_solo = $4, last_solo_industry = $5, mastered = $6, updated_at = $7`,
            [m.id, b.stage, next.supportLevel, next.consecutiveSolo, next.lastSoloIndustry, next.mastered, now],
          );
          await trace(q, { cid: input.cid, actorId: m.id, type: next.mastered && !states[b.stage].mastered ? 'stage.mastered' : solo && b.band >= PASS_BAND ? 'stage.solo_pass' : 'stage.result', context: { kind: 'attempt', id: a.id }, stage: b.stage, supportLevel: snapshot[String(b.stage)] ?? 'WATCH', caseId: c.id, payload: { band: b.band, solo, industry: c.industry } });
        }
        for (const [i, question] of questions.entries()) {
          await q.query('insert into attempt_verification(attempt_id, user_id, position, question) values ($1, $2, $3, $4) on conflict do nothing', [a.id, m.id, i + 1, question]);
        }
      }
      await trace(q, { cid: input.cid, actorId: input.judge.id, type: 'feedback.released', journeyStep: '13', context: { kind: 'attempt', id: a.id }, caseId: c.id });
    });
    released.push(s.id);
  }
  return { released };
}

/** Certificate once every understanding question is answered (the AI judgement is advisory, not a gate). */
export async function issueCertificateIfReady(deps: Deps, attemptId: string, userId: string, cid: string) {
  const { db, clock } = deps;
  const [{ total, answered }] = await db.query<{ total: number; answered: number }>(
    'select count(*)::int as total, count(answer)::int as answered from attempt_verification where attempt_id = $1 and user_id = $2',
    [attemptId, userId],
  );
  if (total === 0 || answered < total) return null;
  const existing = await db.query('select * from certificates where attempt_id = $1 and user_id = $2', [attemptId, userId]);
  if (existing[0]) return existing[0];
  const [s] = await db.query<{ certificate_level: string }>('select certificate_level from attempt_submissions where attempt_id = $1', [attemptId]);
  const cert = { id: newId('cert'), level: s.certificate_level, verifyCode: `THX-${randomDigits(8)}` };
  await db.tx(async (q) => {
    await q.query('insert into certificates(id, attempt_id, user_id, level, verify_code, issued_at) values ($1, $2, $3, $4, $5, $6)', [cert.id, attemptId, userId, cert.level, cert.verifyCode, clock.now()]);
    const members = await q.query<{ n: number }>(`select count(*)::int as n from team_members m join attempts a on a.team_id = m.team_id where a.id = $1`, [attemptId]);
    const issued = await q.query<{ n: number }>('select count(*)::int as n from certificates where attempt_id = $1', [attemptId]);
    if (issued[0].n >= members[0].n) {
      const [a] = await q.query<AttemptRow>('select * from attempts where id = $1', [attemptId]);
      await setState(q, a, 'CREDENTIALED', { cid, actor: null, reason: 'ทุกคนในทีมตอบคำถามตรวจความเข้าใจครบ', now: clock.now() });
    }
    await trace(q, { cid, actorId: userId, type: 'certificate.issued', journeyStep: '14', context: { kind: 'attempt', id: attemptId }, payload: { level: cert.level } });
  });
  return (await db.query('select * from certificates where id = $1', [cert.id]))[0];
}
