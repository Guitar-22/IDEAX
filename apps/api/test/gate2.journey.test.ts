import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';
import { seedThaitern } from '../src/seed/thaitern.js';
import { QUIZ } from '../src/modules/thaitern/curriculum.js';
import { applyStageResult, INITIAL_STAGE, openStages } from '../src/modules/thaitern/stage.js';
import { simulate } from '../src/modules/thaitern/simulator.js';
import { releaseCaseRound } from '../src/modules/thaitern/service.js';
import { CASES } from '../src/seed/thaitern-data.js';
import { DAY } from '../src/core/clock.js';

let h: Harness;
beforeAll(async () => {
  h = await makeHarness({ seed: seedThaitern });
});
afterAll(async () => h.close());

const allRight = (track: 'sme' | 'community') => Object.fromEntries(QUIZ[track].map((q) => [q.id, q.answer]));
const CANVAS = {
  problem: 'ต้นเหตุคือสาขาจามจุรีหมักโยเกิร์ตเท่ากันทุกวัน ทำให้ของเสียช่วงบ่ายสูงถึง 18% เพราะลูกค้าบ่ายน้อยและสั่งแก้ว S',
  target: 'นิสิตที่มาเป็นกลุ่มช่วงบ่าย 14:00–17:00 ซึ่งตอนนี้สั่งแก้ว S เป็นหลัก',
  unit_economics: 'ขายแก้วละ 65 บาท ต้นทุนผันแปร 26 บาท เหลือ 39 บาทต่อแก้ว ของเสีย 18% กินกำไรราว 8,000 บาทต่อเดือน',
  channels: 'ใช้เพจร้านประกาศโปรช่วงบ่าย และป้ายหน้าร้านจามจุรี',
  risks: 'ความเสี่ยงคือโปรทำให้กำไรต่อแก้วลด ถ้ายอดบ่ายไม่เพิ่ม 15% ภายใน 4 สัปดาห์ให้หยุด',
};
const ANSWERS = {
  q1: 'ต้นเหตุคือการหมักรอบเดียวที่สาขาจามจุรี ข้อมูลของเสียเพิ่มจาก 11% เป็น 18% ขณะที่บรรทัดทองคงที่ 4–5% ทำให้กำไรลดแม้ยอดขายรวมเพิ่ม',
  q2: 'ทางเลือกคือหมักสองรอบที่จามจุรีแทนการลดราคา เปรียบเทียบแล้วความเสี่ยงต่ำกว่า วัดผลด้วยของเสียต่ำกว่า 8% และกำไรเดือนละ 8,000 บาทที่กลับมา',
};

async function driveToProgress(user: string, caseId = 'case_yogurt') {
  const c = await h.call('POST', '/v1/attempts', { as: user, body: { caseId } });
  expect(c.status).toBe(201);
  const id = c.body.id;
  await h.call('PUT', `/v1/attempts/${id}/first-draft`, { as: user, body: { text: 'ร่างแรก: น่าจะเป็นเรื่องต้นทุนวัตถุดิบที่สูงขึ้น', done: true } });
  const track = CASES.find((x) => x.id === caseId)!.track;
  const sessions = await h.call('GET', `/v1/attempts/${id}/sessions`, { as: user });
  for (const s of sessions.body.sessions) await h.call('POST', `/v1/attempts/${id}/sessions/${s.key}/complete`, { as: user });
  const quiz = await h.call('POST', `/v1/attempts/${id}/quiz`, { as: user, body: { answers: allRight(track) } });
  const code = quiz.body.attempt.unlock.devAccessCode;
  const un = await h.call('POST', `/v1/attempts/${id}/unlock`, { as: user, body: { code } });
  expect(un.body.state).toBe('IN_PROGRESS');
  return id as string;
}

describe('Gate 2 · journey rules (pure)', () => {
  it('masters a stage only after 2 consecutive solo passes in 2 different industries (TX-01)', () => {
    const solo = (industry: string, passed = true) => ({ solo: true, passed, industry });
    let s = applyStageResult(INITIAL_STAGE, solo('fnb'));
    expect(s).toMatchObject({ consecutiveSolo: 1, mastered: false });
    expect(applyStageResult(s, solo('fnb'))).toMatchObject({ consecutiveSolo: 1, mastered: false }); // same industry proves nothing
    expect(applyStageResult(s, { solo: false, passed: true, industry: 'hospitality' })).toMatchObject({ consecutiveSolo: 0, mastered: false }); // streak broken
    expect(applyStageResult(s, solo('hospitality', false))).toMatchObject({ consecutiveSolo: 0, mastered: false, supportLevel: 'GUIDED' });
    s = applyStageResult(s, solo('hospitality'));
    expect(s).toMatchObject({ consecutiveSolo: 2, mastered: true });
    expect(applyStageResult(s, solo('x', false))).toBe(s); // mastered stays mastered
  });

  it('fades support on supported passes and brings it back on failure (Sawtooth)', () => {
    const pass = { solo: false, passed: true, industry: 'fnb' };
    const a = applyStageResult(INITIAL_STAGE, pass);
    expect(a.supportLevel).toBe('GUIDED');
    expect(applyStageResult(a, pass).supportLevel).toBe('SOLO');
    expect(applyStageResult({ ...a, supportLevel: 'SOLO' }, { ...pass, passed: false }).supportLevel).toBe('GUIDED');
    expect(openStages({ 1: { ...INITIAL_STAGE, mastered: true } })).toEqual([1, 2]);
  });

  it('computes the simulator deterministically with the textbook break-even', () => {
    const p = { unit: 'x', basePrice: 65, baseUnitsPerMonth: 1000, unitCost: 25, fixedCostPerMonth: 40000, wagePerStaff: 0, unitsPerStaff: 10000, priceElasticity: -1, marketingLift: 0, baseHeadcount: 1, baseMarketing: 0 };
    const r = simulate(p, { price: 65, marketing: 0, headcount: 1 });
    expect(r.breakEvenUnits).toBe(1000); // 40,000 ÷ (65 − 25), the quiz question s6
    expect(r.profit).toBe(0);
    expect(simulate(p, { price: 65, marketing: 0, headcount: 1 })).toEqual(r);
    expect(simulate({ ...p, unitsPerStaff: 100 }, { price: 65, marketing: 0, headcount: 1 })).toMatchObject({ units: 100, capacityBound: true });
  });
});

describe('Gate 2 · steps 2–5', () => {
  it('shows teasers without the real problem (TX-02)', async () => {
    const r = await h.call('GET', '/v1/catalog?track=sme', { as: 'u_joe' });
    expect(r.body.cases.map((c: any) => c.id)).toEqual(expect.arrayContaining(['case_yogurt', 'case_hostel']));
    expect(r.body.cases.every((c: any) => !('challenge_brief' in c) && c.track === 'sme')).toBe(true);
    expect(r.body.cases[0].reviewed_by).toBeTruthy(); // expert who reviewed the case is named (TX-17)
  });

  it('lets a learner choose exactly one place per round (TX-02)', async () => {
    const r = await h.call('POST', '/v1/attempts', { as: 'u_joe', body: { caseId: 'case_yogurt' } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ state: 'CHOSEN', journeyStep: '4a' });
    expect(r.body.challengeBrief).toContain('กำไรกลับลดลง');
    const again = await h.call('POST', '/v1/attempts', { as: 'u_joe', body: { caseId: 'case_hostel' } });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_CHOSEN');
  });

  it('enforces the step order on the server', async () => {
    const [a] = await h.db.query(`select a.id from attempts a join team_members m on m.team_id = a.team_id where m.user_id = 'u_joe'`);
    const unlock = await h.call('POST', `/v1/attempts/${a.id}/unlock`, { as: 'u_joe', body: { code: 'TX-0000-0000' } });
    expect(unlock.body.code).toBe('WRONG_STEP');
    const booklet = await h.call('GET', `/v1/attempts/${a.id}/booklet`, { as: 'u_joe' });
    expect(booklet.status).toBe(409);
    const quiz = await h.call('POST', `/v1/attempts/${a.id}/quiz`, { as: 'u_joe', body: { answers: {} } });
    expect(quiz.body.code).toBe('WRONG_STEP');
    const other = await h.call('GET', `/v1/attempts/${a.id}`, { as: 'u_thanawat' });
    expect(other.status).toBe(403);
  });

  it('asks for a first draft before learning (Productive Failure)', async () => {
    const [a] = await h.db.query(`select a.id from attempts a join team_members m on m.team_id = a.team_id where m.user_id = 'u_joe'`);
    const started = await h.call('POST', `/v1/attempts/${a.id}/first-draft/start`, { as: 'u_joe' });
    expect(started.body.firstDraft.startedAt).toBeTruthy();
    const short = await h.call('PUT', `/v1/attempts/${a.id}/first-draft`, { as: 'u_joe', body: { text: 'ไม่รู้', done: true } });
    expect(short.body.code).toBe('DRAFT_TOO_SHORT');
    const ok = await h.call('PUT', `/v1/attempts/${a.id}/first-draft`, { as: 'u_joe', body: { text: 'ร่างแรก: น่าจะเป็นเพราะวัตถุดิบแพงขึ้น', done: true } });
    expect(ok.body.state).toBe('LEARNING');
  });

  it('opens the booklet only after all sessions and a quiz ≥ 80%, with a code', async () => {
    const [a] = await h.db.query(`select a.id from attempts a join team_members m on m.team_id = a.team_id where m.user_id = 'u_joe'`);
    const early = await h.call('POST', `/v1/attempts/${a.id}/quiz`, { as: 'u_joe', body: { answers: allRight('sme') } });
    expect(early.body.code).toBe('SESSIONS_INCOMPLETE');
    const s = await h.call('GET', `/v1/attempts/${a.id}/sessions`, { as: 'u_joe' });
    expect(s.body.sessions).toHaveLength(4);
    expect(JSON.stringify(s.body.quiz)).not.toContain('"answer"'); // answer key never sent
    for (const x of s.body.sessions) await h.call('POST', `/v1/attempts/${a.id}/sessions/${x.key}/complete`, { as: 'u_joe' });
    const seventy = { ...allRight('sme'), s1: 9, s2: 9, s3: 9 };
    const fail = await h.call('POST', `/v1/attempts/${a.id}/quiz`, { as: 'u_joe', body: { answers: seventy } });
    expect(fail.body).toMatchObject({ score: 70, passed: false });
    expect(fail.body.attempt.state).toBe('LEARNING');
    const pass = await h.call('POST', `/v1/attempts/${a.id}/quiz`, { as: 'u_joe', body: { answers: allRight('sme') } });
    expect(pass.body).toMatchObject({ score: 100, passed: true });
    expect(pass.body.attempt.state).toBe('READY_TO_UNLOCK');
    const wrong = await h.call('POST', `/v1/attempts/${a.id}/unlock`, { as: 'u_joe', body: { code: 'TX-1111-1111' } });
    expect(wrong.body.code).toBe('ACCESS_CODE_INVALID');
    const ok = await h.call('POST', `/v1/attempts/${a.id}/unlock`, { as: 'u_joe', body: { code: pass.body.attempt.unlock.devAccessCode } });
    expect(ok.body.state).toBe('IN_PROGRESS');
    expect(new Date(ok.body.unlock.deadlineAt).getTime() - h.clock.now().getTime()).toBe(14 * DAY); // TX-04
  });

  it('requires a verified student card and guardian consent for minors before unlocking (TX-03, TX-12)', async () => {
    const c = await h.call('POST', '/v1/attempts', { as: 'u_noey', body: { caseId: 'case_community' } });
    const id = c.body.id;
    await h.call('PUT', `/v1/attempts/${id}/first-draft`, { as: 'u_noey', body: { text: 'ร่างแรก: ชวนคนรุ่นใหม่มาเรียนทำขนม', done: true } });
    const s = await h.call('GET', `/v1/attempts/${id}/sessions`, { as: 'u_noey' });
    for (const x of s.body.sessions) await h.call('POST', `/v1/attempts/${id}/sessions/${x.key}/complete`, { as: 'u_noey' });
    const quiz = await h.call('POST', `/v1/attempts/${id}/quiz`, { as: 'u_noey', body: { answers: allRight('community') } });
    const code = quiz.body.attempt.unlock.devAccessCode;
    const noCard = await h.call('POST', `/v1/attempts/${id}/unlock`, { as: 'u_noey', body: { code } });
    expect(noCard.body.code).toBe('IDENTITY_REQUIRED');
    await h.call('POST', '/v1/identity/student-card', { as: 'u_noey', body: { fileName: 'card.jpg' } });
    const noGuardian = await h.call('POST', `/v1/attempts/${id}/unlock`, { as: 'u_noey', body: { code } });
    expect(noGuardian.body.code).toBe('GUARDIAN_CONSENT_REQUIRED');
    const otp = await h.call('POST', '/v1/consents/guardian/resend', { as: 'u_noey' });
    await h.call('POST', '/v1/consents/guardian/confirm', { as: 'u_noey', body: { code: otp.body.devOtp } });
    const ok = await h.call('POST', `/v1/attempts/${id}/unlock`, { as: 'u_noey', body: { code } });
    expect(ok.body.state).toBe('IN_PROGRESS');
  });

  it('caps teams at 4 members (TX-06)', async () => {
    const t = await h.call('POST', '/v1/teams', { as: 'u_thanawat', body: { name: 'ทีมทดสอบ' } });
    for (const u of ['u_nicha', 'u_joe', 'u_noey']) {
      const r = await h.call('POST', `/v1/teams/${t.body.id}/members`, { as: 'u_thanawat', body: { userId: u } });
      expect(r.status).toBe(200);
    }
    await h.db.query(`insert into users(id, name, email, role) values ('u_extra', 'คนที่ห้า', 'extra@test.th', 'learner')`);
    const fifth = await h.call('POST', `/v1/teams/${t.body.id}/members`, { as: 'u_thanawat', body: { userId: 'u_extra' } });
    expect(fifth.body.code).toBe('TEAM_FULL');
  });
});

describe('Gate 2 · steps 6–12', () => {
  let id: string;
  beforeAll(async () => {
    id = (await h.db.query(`select a.id from attempts a join team_members m on m.team_id = a.team_id where m.user_id = 'u_joe' and a.case_id = 'case_yogurt'`))[0].id;
  });

  it('serves the booklet on the web with a personal watermark and no download link (TX-05)', async () => {
    const r = await h.call('GET', `/v1/attempts/${id}/booklet`, { as: 'u_joe' });
    expect(r.body.watermark).toContain('โจ');
    expect(r.body.pages.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toMatch(/https?:\/\/|download/i);
    expect(r.body.personas[0]).not.toHaveProperty('facts'); // persona knowledge stays server-side
  });

  it('flags abnormal booklet access', async () => {
    for (let i = 0; i < 22; i++) await h.call('GET', `/v1/attempts/${id}/booklet?page=1`, { as: 'u_joe' });
    const t = await h.db.query(`select count(*)::int as n from trace_events where type = 'booklet.access.anomaly' and context_id = $1`, [id]);
    expect(t[0].n).toBeGreaterThan(0);
    h.clock.advance(2 * 60_000);
  });

  it('streams Stakeholder Chat as SSE and answers only from case facts', async () => {
    const r = await h.call('POST', `/v1/attempts/${id}/personas/ops/messages`, { as: 'u_joe', body: { text: 'ทำไมของเสียช่วงบ่ายถึงเยอะ' } });
    expect(r.headers['content-type']).toContain('text/event-stream');
    const tokens = [...r.raw.matchAll(/event: token\ndata: (.*)\n\n/g)].map((m) => JSON.parse(m[1])).join('');
    expect(tokens).toContain('หมักโยเกิร์ตทีเดียว');
    expect(r.raw).toContain('event: done');
    const unknown = await h.call('POST', `/v1/attempts/${id}/personas/ops/messages`, { as: 'u_joe', body: { text: 'คู่แข่งในเชียงใหม่เป็นใคร' } });
    expect(unknown.raw).toContain('ไม่มีข้อมูลในเคสนี้');
    const hist = await h.call('GET', `/v1/attempts/${id}/personas/ops/messages`, { as: 'u_joe' });
    expect(hist.body.messages).toHaveLength(4);
  });

  it('coach asks questions and never writes the canvas (TX-08), and using it is recorded as support', async () => {
    await h.call('PUT', `/v1/attempts/${id}/canvas/problem`, { as: 'u_joe', body: { text: 'ยอดขายดีแต่กำไรลด' } });
    const r = await h.call('POST', `/v1/attempts/${id}/canvas/problem/coach`, { as: 'u_joe' });
    expect(r.body.questions.length).toBeGreaterThan(0);
    expect(r.body.questions.every((q: string) => q.includes('?'))).toBe(true);
    expect(r.body).not.toHaveProperty('text');
    expect(r.body.missingEvidence).toBe(true);
    const [a] = await h.db.query('select canvas, coach_hints from attempts where id = $1', [id]);
    expect(a.canvas.problem).toBe('ยอดขายดีแต่กำไรลด');
    expect(a.coach_hints.problem.u_joe).toBe(1);
  });

  it('will not start pushback until all 5 canvas parts exist, and only passes a data-backed defence', async () => {
    const early = await h.call('POST', `/v1/attempts/${id}/pushback/start`, { as: 'u_joe' });
    expect(early.body.code).toBe('CANVAS_INCOMPLETE');
    for (const [k, v] of Object.entries(CANVAS)) await h.call('PUT', `/v1/attempts/${id}/canvas/${k}`, { as: 'u_joe', body: { text: v } });
    const start = await h.call('POST', `/v1/attempts/${id}/pushback/start`, { as: 'u_joe' });
    expect(start.body.state).toBe('PUSHBACK');
    expect(start.body.pushback.last.challenge.length).toBeGreaterThan(10);
    const weak = await h.call('POST', `/v1/attempts/${id}/pushback/respond`, { as: 'u_joe', body: { defense: 'ผมคิดว่าถูกแล้ว' } });
    expect(weak.body.passed).toBe(false);
    expect(weak.body.attempt.pushback.round).toBe(2);
    const strong = await h.call('POST', `/v1/attempts/${id}/pushback/respond`, {
      as: 'u_joe',
      body: { defense: 'ข้อมูลใน Data Room แสดงว่าของเสียจามจุรีเพิ่มจาก 11% เป็น 18% ขณะที่บรรทัดทองคงที่ 4–5% ต้นเหตุจึงอยู่ที่การหมักรอบเดียว ไม่ใช่ราคา' },
    });
    expect(strong.body.passed).toBe(true);
    expect(strong.body.attempt.state).toBe('FINALIZING');
  });

  it('simulates profit deterministically and gives an advisory precheck', async () => {
    const r = await h.call('POST', `/v1/attempts/${id}/simulate`, { as: 'u_joe', body: { price: 69, marketing: 8000, headcount: 6 } });
    expect(r.body.outputs).toHaveProperty('profit');
    expect(r.body.baseline).toHaveProperty('breakEvenUnits');
    const p = await h.call('POST', `/v1/attempts/${id}/precheck`, { as: 'u_joe', body: { answers: {} } });
    expect(p.body.advisory).toBe(true);
    expect(p.body.results.some((x: any) => x.level === 'attention' && x.title.startsWith('ยังตอบไม่ครบ'))).toBe(true);
    expect(JSON.stringify(p.body)).not.toMatch(/\d+\s?%/);
  });
});

describe('Gate 2 · submit, feedback, certificate', () => {
  let id: string;
  beforeAll(async () => {
    id = (await h.db.query(`select a.id from attempts a join team_members m on m.team_id = a.team_id where m.user_id = 'u_joe' and a.case_id = 'case_yogurt'`))[0].id;
  });

  it('requires answers to the owner’s questions, then issues a receipt even with AI down (AC-01)', async () => {
    const missing = await h.call('POST', `/v1/attempts/${id}/submit`, { as: 'u_joe', body: { answers: { q1: 'x' }, summary: 's' } });
    expect(missing.body.code).toBe('ANSWERS_REQUIRED');
    h.ai.setDown(true);
    const r = await h.call('POST', `/v1/attempts/${id}/submit`, { as: 'u_joe', body: { answers: ANSWERS, summary: 'สรุป: หมักสองรอบที่จามจุรีเพื่อลดของเสียจาก 18% ให้ต่ำกว่า 8% กำไรกลับมาเดือนละ 8,000 บาท' } });
    expect(r.status).toBe(201);
    expect(r.body.receipt.id).toMatch(/^TXR-/);
    await h.queue.drain();
    h.ai.setDown(false);
    const [s] = await h.db.query('select status, ai_status, shortlisted from attempt_submissions where attempt_id = $1', [id]);
    expect(s).toMatchObject({ status: 'SCREENED', ai_status: 'ABANDONED', shortlisted: null }); // nobody excluded because AI failed
  });

  it('screens with AI when available; every quoted line exists in the work (AC-03)', async () => {
    const hostel = await driveToProgress('u_thanawat', 'case_hostel');
    for (const [k, v] of Object.entries(CANVAS)) await h.call('PUT', `/v1/attempts/${hostel}/canvas/${k}`, { as: 'u_thanawat', body: { text: v } });
    await h.call('POST', `/v1/attempts/${hostel}/pushback/start`, { as: 'u_thanawat' });
    await h.call('POST', `/v1/attempts/${hostel}/pushback/respond`, { as: 'u_thanawat', body: { defense: 'ข้อมูลอัตราเข้าพักวันธรรมดา 42% เทียบสุดสัปดาห์ 96% บอกว่าต้นเหตุคือกลุ่มลูกค้าวันธรรมดาที่ยังไม่ได้เข้าถึง ไม่ใช่ราคา' } });
    const r = await h.call('POST', `/v1/attempts/${hostel}/submit`, { as: 'u_thanawat', body: { answers: ANSWERS, summary: 'สรุป: ขายแพ็กเกจวันธรรมดาให้นักท่องเที่ยวทำงานระยะยาว กำไรเพิ่มเดือนละ 30,000 บาท' } });
    expect(r.status).toBe(201);
    await h.queue.drain();
    const [s] = await h.db.query<any>('select s.*, a.canvas from attempt_submissions s join attempts a on a.id = s.attempt_id where attempt_id = $1', [hostel]);
    expect(s.status).toBe('SCREENED');
    const text = [s.summary, ...Object.values(s.answers), ...Object.values(s.canvas)].join('\n');
    for (const b of s.ai_bands) for (const q of b.quotes) expect(text).toContain(q);
    const fb = await h.call('GET', `/v1/attempts/${hostel}/feedback`, { as: 'u_thanawat' });
    expect(fb.body.code).toBe('NOT_RELEASED'); // AI screening is never shown as a result
  });

  it('expires an attempt 14 days after unlock and refuses late work (TX-04)', async () => {
    await h.db.query(`insert into users(id, name, email, role, student_card_verified) values ('u_late', 'ผู้เรียนส่งช้า', 'late@test.th', 'learner', true)`);
    for (const c of ['tos', 'confidentiality', 'pdpa_ai']) await h.db.query(`insert into consent_records(user_id, code, text_version, action, channel) values ('u_late', $1, 'v', 'given', 'test')`, [c]);
    const id2 = await driveToProgress('u_late', 'case_hostel');
    h.clock.advance(14 * DAY + 1000);
    const r = await h.call('GET', `/v1/attempts/${id2}`, { as: 'u_late' });
    expect(r.body.state).toBe('EXPIRED');
    const s = await h.call('POST', `/v1/attempts/${id2}/pushback/start`, { as: 'u_late' });
    expect(s.body.code).toBe('DEADLINE_PASSED');
    const booklet = await h.call('GET', `/v1/attempts/${id2}/booklet`, { as: 'u_late' });
    expect(booklet.status).toBe(409);
  });

  it('after humans release, shows confirmed feedback, moves stages, and issues a certificate after the understanding check', async () => {
    const early = await releaseCaseRound(h.deps, { caseId: 'case_yogurt', judge: { id: 'u_judge', role: 'judge', name: 'กรรมการ' }, cid: 'cid-t' }).catch((e) => e);
    expect(early.code).toBe('NOT_ALL_CONFIRMED');
    await h.db.query(
      `update attempt_submissions set status = 'CONFIRMED', confirmed_by = 'u_judge', judge_feedback = 'ใช้ข้อมูลของเสียได้ดี',
         confirmed_bands = '[{"key":"structure","stage":1,"band":3},{"key":"data","stage":3,"band":4},{"key":"options","stage":5,"band":2},{"key":"finance","stage":6,"band":3}]'
       where attempt_id = $1`,
      [id],
    );
    const rel = await releaseCaseRound(h.deps, { caseId: 'case_yogurt', judge: { id: 'u_judge', role: 'judge', name: 'กรรมการ' }, cid: 'cid-t' });
    expect(rel.released).toHaveLength(1);

    const fb = await h.call('GET', `/v1/attempts/${id}/feedback`, { as: 'u_joe' });
    expect(fb.body).toMatchObject({ judgeFeedback: 'ใช้ข้อมูลของเสียได้ดี', certificateLevel: 'participation' });
    expect(fb.body.bands.find((b: any) => b.key === 'data').name).toBe('ใช้ข้อมูลจริงเป็นหลักฐาน');

    const stages = await h.call('GET', '/v1/me/stages', { as: 'u_joe' });
    const st = Object.fromEntries(stages.body.stages.map((s: any) => [s.n, s]));
    expect(st[1]).toMatchObject({ supportLevel: 'GUIDED', mastered: false }); // passed with support: fades one level
    expect(st[5].supportLevel).toBe('GUIDED'); // failed: support comes back

    const v = await h.call('GET', `/v1/attempts/${id}/verification`, { as: 'u_joe' });
    expect(v.body.certificate).toBeNull();
    let last: any;
    for (const q of v.body.questions) {
      last = await h.call('POST', `/v1/attempts/${id}/verification/${q.position}`, { as: 'u_joe', body: { answer: 'เพราะข้อมูลของเสียเพิ่มขึ้นเฉพาะที่จามจุรี ถ้าบรรทัดทองมีของเสียเพิ่มด้วย ผมจะกลับไปดูเรื่องวัตถุดิบแทน' } });
    }
    expect(last.body.certificate.level).toBe('participation');
    const pub = await h.call('GET', `/v1/public/certificates/${last.body.certificate.verifyCode}`);
    expect(pub.body).toMatchObject({ level: 'participation', title: expect.stringContaining('นมเย็นดี') });
    expect(pub.body).not.toHaveProperty('email');
    const att = await h.call('GET', `/v1/attempts/${id}`, { as: 'u_joe' });
    expect(att.body.state).toBe('CREDENTIALED');
  });
});
