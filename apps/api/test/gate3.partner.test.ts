import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';
import { seedThaitern } from '../src/seed/thaitern.js';
import { anonymize, parseCsv } from '../src/modules/partner/anonymize.js';
import { driveToSubmitted, makeLearner } from './journey-helpers.js';
import { DAY } from '../src/core/clock.js';

let h: Harness;
beforeAll(async () => {
  h = await makeHarness({ seed: seedThaitern });
});
afterAll(async () => h.close());

describe('Gate 3 · anonymisation (pure)', () => {
  it('masks phones, e-mails, national IDs, LINE ids and named people', () => {
    const r = anonymize('โทร 081-234-5678 หรือ owner@shop.co.th บัตร 1-2345-67890-12-3 ไลน์: @nomyen คุยกับคุณสมชาย', ['สมชาย']);
    expect(r.text).not.toMatch(/081|owner@|67890|nomyen|สมชาย/);
    expect(r.replaced).toBe(5);
  });
  it('reads Data Room CSV with numbers as numbers', () => {
    expect(parseCsv('เดือน,ยอด\nม.ค.,2400')).toEqual({ columns: ['เดือน', 'ยอด'], rows: [['ม.ค.', 2400]] });
  });
});

describe('Gate 3 · case production pipeline (docs §6)', () => {
  let caseId: string;

  it('ops opens a case; another SME owner cannot see it', async () => {
    const r = await h.call('POST', '/v1/partner/cases', {
      as: 'u_ops',
      body: { orgId: 'org_yogurt', track: 'sme', smeGroup: 'fnb', subCategory: 'Beverages & Ingredients', industry: 'fnb_dairy', title: 'นมเย็นดี · ช่องทางขายส่ง', teaser: 'ร้านนมสูตรครอบครัว (ตัวอย่างสมมติ)', challengeBrief: 'อยากขายส่งให้คาเฟ่ แต่ไม่รู้จะตั้งราคาอย่างไร', stages: [1, 3, 6] },
    });
    expect(r.status).toBe(201);
    caseId = r.body.id;
    const other = await h.call('GET', `/v1/partner/cases/${caseId}`, { as: 'u_owner2' });
    expect(other.status).toBe(403);
  });

  it('refuses data before the owner signs the licence, then records markings', async () => {
    const early = await h.call('POST', `/v1/partner/cases/${caseId}/assets`, { as: 'u_owner', body: { kind: 'brief', name: 'ภาพรวม', content: 'x' } });
    expect(early.body.code).toBe('AGREEMENT_REQUIRED');
    expect((await h.call('POST', `/v1/partner/cases/${caseId}/agreement/sign`, { as: 'u_owner' })).body.signed).toBe(true);
    const add = (body: any) => h.call('POST', `/v1/partner/cases/${caseId}/assets`, { as: 'u_owner', body });
    expect((await add({ kind: 'brief', name: 'ภาพรวม', content: 'ขายหน้าร้านวันละ 300 ขวด ติดต่อคุณสมชายที่ 081-234-5678 หรือ somchai@nomyen.co.th', markings: ['confidential'] })).status).toBe(201);
    await add({ kind: 'audio_transcript', name: 'คุณสุดาเล่า', content: 'เราอยากขายส่งให้คาเฟ่ 20 ร้าน แต่ไม่แน่ใจว่าราคาส่งควรต่ำกว่าหน้าร้านเท่าไร' });
    await add({ kind: 'data', name: 'ยอดขายรายเดือน', content: 'เดือน,ขวด\nม.ค.,9000\nก.พ.,9400' });
    await add({ kind: 'persona', name: 'ผู้จัดการ', content: JSON.stringify({ key: 'mgr', name: 'ผู้จัดการ', role: 'ops', intro: 'ถามเรื่องการผลิต', facts: [{ keywords: ['ผลิต'], answer: 'ผลิตได้วันละ 500 ขวด' }] }) });
    await add({ kind: 'finance', name: 'ตัวเลข', content: JSON.stringify({ unit: 'ขวด', basePrice: 35, baseUnitsPerMonth: 9000, unitCost: 14, fixedCostPerMonth: 60000, wagePerStaff: 12000, unitsPerStaff: 3000, priceElasticity: -1.2, marketingLift: 0.2, baseHeadcount: 3, baseMarketing: 2000 }) });
    await add({ kind: 'question', name: 'คำถาม', content: 'ราคาส่งควรเป็นเท่าไร\nควรเริ่มกับคาเฟ่กี่ร้าน' });
    await add({ kind: 'other', name: 'สูตรลับ', content: 'สูตรนมผสมน้ำผึ้งป่า 3%', markings: ['no_learner'] });
    await add({ kind: 'other', name: 'รายชื่อลูกค้าประจำ', content: 'คุณเอ คุณบี', markings: ['pii'] });
    await add({ kind: 'other', name: 'โปรโมชันเก่า', content: 'โปรหมดอายุแล้ว', markings: ['time_bound'], usableUntil: '2026-01-31' });
  });

  it('cannot draft before anonymising; after it, nothing identifying or held back reaches learners (TX-14)', async () => {
    const early = await h.call('POST', `/v1/partner/cases/${caseId}/draft`, { as: 'u_ops' });
    expect(early.body.code).toBe('WRONG_CASE_STATUS');
    const an = await h.call('POST', `/v1/partner/cases/${caseId}/anonymize`, { as: 'u_ops', body: { maskTerms: ['สมชาย'] } });
    expect(an.body.replaced).toBeGreaterThanOrEqual(3);
    const d = await h.call('POST', `/v1/partner/cases/${caseId}/draft`, { as: 'u_ops' });
    expect(d.body).toMatchObject({ versionNo: 1, excluded: 3, questions: 2, personas: 1 });
    const pv = await h.call('GET', `/v1/partner/cases/${caseId}/preview`, { as: 'u_owner' });
    const text = JSON.stringify(pv.body);
    expect(text).not.toMatch(/081-234|somchai@|สมชาย|น้ำผึ้งป่า|คุณเอ|โปรหมดอายุ/);
    expect(text).toContain('Founder Audio Briefing');
    expect(pv.body.dataRoom[0].rows[0]).toEqual(['ม.ค.', 9000]);
  });

  it('needs an expert, then the owner, before publishing; the reviewer is named (TX-17)', async () => {
    const tooEarly = await h.call('POST', `/v1/partner/cases/${caseId}/owner-approval`, { as: 'u_owner', body: { approve: true } });
    expect(tooEarly.body.code).toBe('WRONG_CASE_STATUS');
    const revise = await h.call('POST', `/v1/partner/cases/${caseId}/expert-review`, { as: 'u_reviewer', body: { decision: 'revise', notes: 'เพิ่มข้อมูลต้นทุนขนส่ง' } });
    expect(revise.body.status).toBe('DRAFTING');
    const d2 = await h.call('POST', `/v1/partner/cases/${caseId}/draft`, { as: 'u_ops' });
    expect(d2.body.versionNo).toBe(2);
    const ok = await h.call('POST', `/v1/partner/cases/${caseId}/expert-review`, { as: 'u_reviewer', body: { decision: 'approve', notes: 'สมจริงและชัดเจน' } });
    expect(ok.body.status).toBe('OWNER_APPROVAL');
    const notMine = await h.call('POST', `/v1/partner/cases/${caseId}/owner-approval`, { as: 'u_owner2', body: { approve: true } });
    expect(notMine.status).toBe(403);
    const pub = await h.call('POST', `/v1/partner/cases/${caseId}/owner-approval`, { as: 'u_owner', body: { approve: true } });
    expect(pub.body.status).toBe('PUBLISHED');
    const cat = await h.call('GET', '/v1/catalog', { as: 'u_joe' });
    expect(cat.body.cases.find((c: any) => c.id === caseId).reviewed_by).toBe('ดร. วรเมธ (ผู้เชี่ยวชาญตรวจเคส)');
  });

  it('takedown stops new unlocks but lets running teams finish (TX-15)', async () => {
    await makeLearner(h, 'u_run');
    await makeLearner(h, 'u_wait');
    await makeLearner(h, 'u_new');
    // one team already working, one ready to unlock
    const run = await h.call('POST', '/v1/attempts', { as: 'u_run', body: { caseId } });
    const drive = async (user: string, id: string) => {
      await h.call('PUT', `/v1/attempts/${id}/first-draft`, { as: user, body: { text: 'ร่างแรกของทีมที่เริ่มแล้ว', done: true } });
      const s = await h.call('GET', `/v1/attempts/${id}/sessions`, { as: user });
      for (const x of s.body.sessions) await h.call('POST', `/v1/attempts/${id}/sessions/${x.key}/complete`, { as: user });
      const { QUIZ } = await import('../src/modules/thaitern/curriculum.js');
      return h.call('POST', `/v1/attempts/${id}/quiz`, { as: user, body: { answers: Object.fromEntries(QUIZ.sme.map((q) => [q.id, q.answer])) } });
    };
    const q1 = await drive('u_run', run.body.id);
    await h.call('POST', `/v1/attempts/${run.body.id}/unlock`, { as: 'u_run', body: { code: q1.body.attempt.unlock.devAccessCode } });
    const wait = await h.call('POST', '/v1/attempts', { as: 'u_wait', body: { caseId } });
    const q2 = await drive('u_wait', wait.body.id);

    const td = await h.call('POST', `/v1/partner/cases/${caseId}/takedown`, { as: 'u_owner', body: { reason: 'ขอปรับข้อมูลราคา' } });
    expect(td.body).toMatchObject({ status: 'SUSPENDED', runningAttempts: 1 });
    expect((await h.call('GET', `/v1/attempts/${run.body.id}/booklet`, { as: 'u_run' })).status).toBe(200);
    const blocked = await h.call('POST', `/v1/attempts/${wait.body.id}/unlock`, { as: 'u_wait', body: { code: q2.body.attempt.unlock.devAccessCode } });
    expect(blocked.body.code).toBe('CASE_NOT_AVAILABLE');
    const choose = await h.call('POST', '/v1/attempts', { as: 'u_new', body: { caseId } });
    expect(choose.body.code).toBe('CASE_NOT_AVAILABLE');
    expect((await h.call('GET', '/v1/catalog', { as: 'u_new' })).body.cases.some((c: any) => c.id === caseId)).toBe(false);
  });

  it('retiring destroys the raw data (appendix C §11)', async () => {
    const r = await h.call('POST', `/v1/partner/cases/${caseId}/retire`, { as: 'u_ops' });
    expect(r.body.status).toBe('RETIRED');
    const assets = await h.db.query('select content, anonymized_content from case_assets where case_id = $1', [caseId]);
    expect(assets.every((a) => a.content === '[ลบตามข้อตกลงสิ้นสุด]' && a.anonymized_content === null)).toBe(true);
  });
});

describe('Gate 3 · two-layer evaluation (docs §8)', () => {
  const subs: Record<string, Awaited<ReturnType<typeof driveToSubmitted>>> = {};

  beforeAll(async () => {
    for (const u of ['u_a', 'u_b', 'u_c', 'u_d', 'u_e']) await makeLearner(h, u);
    for (const u of ['u_a', 'u_b', 'u_c', 'u_d']) subs[u] = await driveToSubmitted(h, u, 'case_yogurt');
    subs.u_e = await driveToSubmitted(h, 'u_e', 'case_yogurt', { strong: false });
  });

  it('AI screening shortlists strong works and keeps weak ones for judges only', () => {
    expect(['u_a', 'u_b', 'u_c', 'u_d'].every((u) => subs[u].shortlisted === true)).toBe(true);
    expect(subs.u_e.shortlisted).toBe(false);
  });

  it('shows the owner only shortlisted works, max 3 new reads a week (TX-11)', async () => {
    const list = await h.call('GET', '/v1/partner/cases/case_yogurt/shortlist', { as: 'u_owner' });
    expect(list.body.submissions.map((s: any) => s.id)).not.toContain(subs.u_e.submissionId);
    expect(list.body.quota).toMatchObject({ perWeek: 3, used: 0 });
    const weak = await h.call('GET', `/v1/partner/submissions/${subs.u_e.submissionId}`, { as: 'u_owner' });
    expect(weak.status).toBe(403);
    for (const u of ['u_a', 'u_b', 'u_c']) expect((await h.call('GET', `/v1/partner/submissions/${subs[u].submissionId}`, { as: 'u_owner' })).status).toBe(200);
    expect((await h.call('GET', `/v1/partner/submissions/${subs.u_a.submissionId}`, { as: 'u_owner' })).status).toBe(200); // re-reading is free
    const fourth = await h.call('GET', `/v1/partner/submissions/${subs.u_d.submissionId}`, { as: 'u_owner' });
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe('WEEKLY_QUOTA');
    h.clock.advance(7 * DAY);
    expect((await h.call('GET', `/v1/partner/submissions/${subs.u_d.submissionId}`, { as: 'u_owner' })).status).toBe(200);
    const judge = await h.call('GET', `/v1/partner/submissions/${subs.u_e.submissionId}`, { as: 'u_judge' });
    expect(judge.status).toBe(200);
    expect(judge.body.aiBands.length).toBe(4);
  });

  it('owner gets an AI draft following the feedback guide, edits it, and can pick SME’s Choice', async () => {
    const d = await h.call('POST', `/v1/partner/submissions/${subs.u_a.submissionId}/feedback-draft`, { as: 'u_owner' });
    expect(d.body.proposed).toBe(true);
    expect(d.body.guide).toContain('ไม่วิจารณ์ตัวบุคคล');
    const r = await h.call('POST', `/v1/partner/submissions/${subs.u_a.submissionId}/owner-feedback`, { as: 'u_owner', body: { feedback: 'ชอบที่ใช้ข้อมูลของเสียแยกสาขา อยากชวนมาคุยเรื่องทดลองหมักสองรอบจริง', smeChoice: true } });
    expect(r.body.saved).toBe(true);
    const weak = await h.call('POST', `/v1/partner/submissions/${subs.u_e.submissionId}/owner-feedback`, { as: 'u_owner', body: { feedback: 'x'.repeat(30) } });
    expect(weak.status).toBe(403);
  });

  it('judges confirm every criterion, with a reason when they change the AI band', async () => {
    const s = await h.call('GET', `/v1/partner/submissions/${subs.u_b.submissionId}`, { as: 'u_judge' });
    const keys = s.body.criteria.map((c: any) => c.key);
    const partial = await h.call('POST', `/v1/partner/submissions/${subs.u_b.submissionId}/confirm`, { as: 'u_judge', body: { bands: [{ key: keys[0], band: 3 }], feedback: 'ใช้ข้อมูลดี ควรประเมินความเสี่ยงให้ละเอียดขึ้น' } });
    expect(partial.body.code).toBe('BANDS_INCOMPLETE');
    const ai = Object.fromEntries(s.body.aiBands.map((b: any) => [b.key, b.band]));
    const changed = keys.map((k: string, i: number) => ({ key: k, band: i === 0 ? (ai[k] === 1 ? 2 : 1) : ai[k] }));
    const noReason = await h.call('POST', `/v1/partner/submissions/${subs.u_b.submissionId}/confirm`, { as: 'u_judge', body: { bands: changed, feedback: 'ใช้ข้อมูลดี ควรประเมินความเสี่ยงให้ละเอียดขึ้น' } });
    expect(noReason.body.code).toBe('REASON_REQUIRED');
    const owner = await h.call('POST', `/v1/partner/submissions/${subs.u_b.submissionId}/confirm`, { as: 'u_owner', body: { bands: [], feedback: 'x' } });
    expect(owner.status).toBe(403);
  });

  it('releases only when every team is confirmed, so every team gets feedback (TX-10)', async () => {
    const early = await h.call('POST', '/v1/partner/cases/case_yogurt/release', { as: 'u_judge' });
    expect(early.body.code).toBe('NOT_ALL_CONFIRMED');
    for (const u of Object.keys(subs)) {
      const s = await h.call('GET', `/v1/partner/submissions/${subs[u].submissionId}`, { as: 'u_judge' });
      const bands = s.body.aiBands.map((b: any) => ({ key: b.key, band: b.band }));
      const r = await h.call('POST', `/v1/partner/submissions/${subs[u].submissionId}/confirm`, { as: 'u_judge', body: { bands, feedback: 'ขอบคุณที่ตั้งใจทำ ข้อเสนอชัดและอ้างข้อมูลจริง' } });
      expect(r.body.status).toBe('CONFIRMED');
    }
    const rel = await h.call('POST', '/v1/partner/cases/case_yogurt/release', { as: 'u_judge' });
    expect(rel.body.released).toHaveLength(5);
    const fa = await h.call('GET', `/v1/attempts/${subs.u_a.attemptId}/feedback`, { as: 'u_a' });
    expect(fa.body).toMatchObject({ smeChoice: true, certificateLevel: 'sme_choice', ownerFeedback: expect.stringContaining('หมักสองรอบ') });
    const fe = await h.call('GET', `/v1/attempts/${subs.u_e.attemptId}/feedback`, { as: 'u_e' });
    expect(fe.body.judgeFeedback).toBeTruthy(); // the screened-out team still gets feedback
    expect(fe.body.certificateLevel).toBe('participation');
    const again = await h.call('POST', `/v1/partner/submissions/${subs.u_a.submissionId}/confirm`, { as: 'u_judge', body: { bands: [], feedback: 'x'.repeat(20) } });
    expect(again.body.code).toBe('ALREADY_RELEASED');
  });
});
