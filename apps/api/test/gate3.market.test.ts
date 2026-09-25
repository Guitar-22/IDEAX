import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';
import { seedIdeaxCatalog, seedIdeaxSubmissions } from '../src/seed/ideax.js';
import { seedThaitern } from '../src/seed/thaitern.js';
import { copiedPhrases, splitPayment, tierOf } from '../src/modules/market/index.js';
import { driveToSubmitted, makeLearner } from './journey-helpers.js';
import { DAY } from '../src/core/clock.js';

let h: Harness;
let nichaSub: string;
let nichaPub: string;

beforeAll(async () => {
  h = await makeHarness({
    seed: async (d) => {
      await seedIdeaxCatalog(d);
      await seedIdeaxSubmissions(d);
      await seedThaitern(d);
    },
  });
  // teacher releases ณิชา's chapter so it has verified items
  nichaSub = (await h.db.query(`select id from submissions where student_id = 'u_nicha'`))[0].id;
  const sv = (await h.db.query('select id from submission_versions where submission_id = $1', [nichaSub]))[0].id;
  let r = await h.call('GET', `/v1/reviews/${sv}`, { as: 'u_teacher' });
  for (const c of r.body.criteria) await h.call('POST', `/v1/reviews/${sv}/criteria/${c.id}/accept`, { as: 'u_teacher' });
  r = await h.call('GET', `/v1/reviews/${sv}`, { as: 'u_teacher' });
  for (const i of r.body.items.filter((x: any) => x.status === 'NO_PROPOSAL')) {
    await h.call('POST', `/v1/reviews/${sv}/items/${i.no}/decision`, { as: 'u_teacher', body: { action: 'flag', codes: ['D'], rowVersion: i.rowVersion } });
  }
  await h.call('POST', `/v1/reviews/${sv}/release`, { as: 'u_teacher', body: { mode: 'finalize' } });
  // an unverified organisation
  await h.db.query(`insert into organizations(id, name, kind, domain_verified) values ('org_unverified', 'บริษัทยังไม่ยืนยัน', 'company', false)`);
  await h.db.query(`insert into users(id, name, email, role, org_id) values ('u_org2', 'บริษัทยังไม่ยืนยัน', 'org2@test.th', 'org_member', 'org_unverified')`);
});
afterAll(async () => h.close());

const FIELDS = {
  problem: 'ธุรกิจครอบครัวไทยสะดุดตอนส่งต่อรุ่นสอง เพราะระบบอยู่ในความจำผู้ก่อตั้ง',
  approach: 'ทบทวนวรรณกรรมสามสาย และติดตามผู้สืบทอด 12 รายหนึ่งปีการศึกษา',
  rights: 'ลิขสิทธิ์เป็นของผู้วิจัยและสถาบัน เปิดให้เจรจาการเข้าถึงสนามวิจัย',
};
const search = (q: string, as = 'u_org') => h.call('GET', `/v1/market/search?q=${encodeURIComponent(q)}`, { as });

describe('Gate 3 · pure rules', () => {
  it('detects Thai text copied from a confidential source, not ordinary overlap', () => {
    const src = ['ช่วงบ่าย 14:00–17:00 ที่สาขาจามจุรีมีโยเกิร์ตเหลือทิ้งบ่อย พนักงานบอกว่าลูกค้าช่วงบ่ายสั่งแก้ว L น้อยลงเพราะคิดว่าแพง'];
    expect(copiedPhrases(src, 'สรุปว่า ที่สาขาจามจุรีมีโยเกิร์ตเหลือทิ้งบ่อย จึงควรแก้').length).toBeGreaterThan(0);
    expect(copiedPhrases(src, 'ร้านมีของเสียช่วงบ่ายที่สาขาจามจุรี ควรปรับรอบการผลิต')).toEqual([]);
  });
  it('computes tiers like the mockup', () => {
    expect(tierOf(9, 9, true)).toBe('A');
    expect(tierOf(9, 9, false)).toBe('B');
    expect(tierOf(8, 16, false)).toBe('B');
    expect(tierOf(7, 16, false)).toBe('C');
  });
  it('splits an idea purchase 40% to the learner with balanced double entry', () => {
    const e = splitPayment(50_000, 'idea_purchase', 'u_x');
    const debit = e.filter((x) => x.side === 'debit').reduce((s, x) => s + x.amount, 0);
    const credit = e.filter((x) => x.side === 'credit').reduce((s, x) => s + x.amount, 0);
    expect(debit).toBe(credit);
    expect(e.find((x) => x.account === 'learner_payable')).toMatchObject({ amount: 20_000, userId: 'u_x' });
    const odd = splitPayment(33_333, 'idea_purchase', 'u_x');
    expect(odd.filter((x) => x.side === 'credit').reduce((s, x) => s + x.amount, 0)).toBe(33_333);
  });
});

describe('Gate 3 · publishing is a separate, explicit choice', () => {
  it('refuses forbidden fields such as grades or AI proposals', async () => {
    const r = await h.call('POST', '/v1/publications', { as: 'u_nicha', body: { source: { kind: 'submission', id: nichaSub }, title: 't', fields: { ...FIELDS, grades: 'B+' }, visibility: 'public' } });
    expect(r.body.code).toBe('FIELD_NOT_ALLOWED');
    expect(r.body.details.fields).toEqual(['grades']);
  });

  it('refuses work that nothing human has verified yet', async () => {
    const sub = (await h.db.query(`select id from submissions where student_id = 'u_thanawat'`))[0].id;
    const r = await h.call('POST', '/v1/publications', { as: 'u_thanawat', body: { source: { kind: 'submission', id: sub }, title: 't', fields: FIELDS, visibility: 'public' } });
    expect(r.body.code).toBe('NOTHING_VERIFIED');
    const notMine = await h.call('POST', '/v1/publications', { as: 'u_thanawat', body: { source: { kind: 'submission', id: nichaSub }, title: 't', fields: FIELDS, visibility: 'public' } });
    expect(notMine.status).toBe(403);
  });

  it('keeps drafts and private coursework out of search (AC-06)', async () => {
    const r = await h.call('POST', '/v1/publications', { as: 'u_nicha', body: { source: { kind: 'submission', id: nichaSub }, title: 'Digital capability ของผู้สืบทอดรุ่นสอง', fields: FIELDS, visibility: 'public', opportunities: ['research', 'consult'] } });
    expect(r.status).toBe(201);
    expect(r.body.tier).toBe('B');
    nichaPub = r.body.id;
    expect((await search('ผู้สืบทอด')).body.results).toHaveLength(0);
    expect((await search('dynamic capabilities')).body.results).toHaveLength(0); // chapter text is never indexed
    const pv = await h.call('GET', `/v1/publications/${nichaPub}/preview`, { as: 'u_nicha' });
    expect(pv.body.card.verification).toMatch(/ผศ\.ดร\. กมลชนก วีรกุล ตรวจตามเกณฑ์/);
    expect(pv.body.notOnCard).toContain('ข้อเสนอของ AI');
  });

  it('publishes into the projection only: no grades, no AI rationale', async () => {
    const r = await h.call('POST', `/v1/publications/${nichaPub}/publish`, { as: 'u_nicha' });
    expect(r.body.status).toBe('PUBLISHED');
    const s = await search('ผู้สืบทอด');
    expect(s.body.results).toHaveLength(1);
    expect(s.body.index).toBe('publication_projection');
    const text = JSON.stringify(s.body);
    expect(text).not.toMatch(/"grade"|"why"|"ann"|B\+/);
    expect((await search('dynamic capabilities')).body.results).toHaveLength(0);
    const learnerSearch = await search('ผู้สืบทอด', 'u_joe');
    expect(learnerSearch.status).toBe(403);
  });

  it('keeps link-only works out of search, and org-only works from unverified orgs', async () => {
    await makeLearner(h, 'u_link', { talent: true });
    await h.db.query(`insert into enrollments(course_id, user_id) values ('crs_dba801', 'u_link')`);
    const p = await h.call('POST', '/v1/publications', { as: 'u_nicha', body: { source: { kind: 'submission', id: nichaSub }, title: 'ฉบับลิงก์เท่านั้น ผู้สืบทอดลิงก์', fields: FIELDS, visibility: 'link' } });
    await h.call('POST', `/v1/publications/${p.body.id}/publish`, { as: 'u_nicha' });
    expect((await search('ผู้สืบทอดลิงก์')).body.results).toHaveLength(0);
    expect((await h.call('GET', `/v1/public/publications/${p.body.id}`)).status).toBe(200);
    const o = await h.call('POST', '/v1/publications', { as: 'u_nicha', body: { source: { kind: 'submission', id: nichaSub }, title: 'ฉบับองค์กรที่ยืนยันแล้ว เฉพาะองค์กร', fields: FIELDS, visibility: 'org' } });
    await h.call('POST', `/v1/publications/${o.body.id}/publish`, { as: 'u_nicha' });
    expect((await search('เฉพาะองค์กร')).body.results).toHaveLength(1);
    expect((await search('เฉพาะองค์กร', 'u_org2')).body.results).toHaveLength(0);
    expect((await h.call('GET', `/v1/public/publications/${o.body.id}`)).status).toBe(404);
  });
});

describe('Gate 3 · team works and confidentiality', () => {
  let attemptId: string;
  beforeAll(async () => {
    await makeLearner(h, 'u_t1', { talent: true });
    await makeLearner(h, 'u_t2');
    const t = await h.call('POST', '/v1/teams', { as: 'u_t1', body: { name: 'ทีมนมเย็น' } });
    await h.call('POST', `/v1/teams/${t.body.id}/members`, { as: 'u_t1', body: { userId: 'u_t2' } });
    const s = await driveToSubmitted(h, 'u_t1', 'case_yogurt', { teamId: t.body.id });
    attemptId = s.attemptId;
    const d = await h.call('GET', `/v1/partner/submissions/${s.submissionId}`, { as: 'u_judge' });
    await h.call('POST', `/v1/partner/submissions/${s.submissionId}/confirm`, { as: 'u_judge', body: { bands: d.body.aiBands.map((b: any) => ({ key: b.key, band: b.band })), feedback: 'ใช้ข้อมูลของเสียได้ดีมาก ข้อเสนอทำได้จริง' } });
    await h.call('POST', '/v1/partner/cases/case_yogurt/release', { as: 'u_judge' });
  });

  it('refuses text copied from the owner’s booklet', async () => {
    const r = await h.call('POST', '/v1/publications', {
      as: 'u_t1',
      body: { source: { kind: 'attempt', id: attemptId }, title: 'ลดของเสีย', fields: { problem: 'ช่วงบ่าย 14:00–17:00 ที่สาขาจามจุรีมีโยเกิร์ตเหลือทิ้งบ่อย พนักงานบอกว่าลูกค้าช่วงบ่ายสั่งแก้ว L น้อยลงเพราะคิดว่าแพง' }, visibility: 'public' },
    });
    expect(r.body.code).toBe('CONFIDENTIAL_CONTENT');
  });

  it('waits for every co-author before going public (AC-05)', async () => {
    const p = await h.call('POST', '/v1/publications', { as: 'u_t1', body: { source: { kind: 'attempt', id: attemptId }, title: 'แผนลดของเสียร้านเครื่องดื่ม', fields: { problem: 'ร้านเครื่องดื่มที่กำไรลดเพราะของเสียต่างสาขา', approach: 'แยกข้อมูลของเสียรายสาขาแล้วปรับรอบการผลิต' }, visibility: 'public' } });
    expect(p.body.coAuthors).toBe(1);
    const pub = await h.call('POST', `/v1/publications/${p.body.id}/publish`, { as: 'u_t1' });
    expect(pub.body).toMatchObject({ status: 'PENDING_COAUTHORS', waitingFor: 1 });
    expect((await search('ของเสียต่างสาขา')).body.results).toHaveLength(0);
    const outsider = await h.call('POST', `/v1/publications/${p.body.id}/consent`, { as: 'u_joe' });
    expect(outsider.status).toBe(403);
    const ok = await h.call('POST', `/v1/publications/${p.body.id}/consent`, { as: 'u_t2' });
    expect(ok.body.status).toBe('PUBLISHED');
    const s = await search('ของเสียต่างสาขา');
    expect(s.body.results[0].verification).toMatch(/กรรมการยืนยันผลในเคส/);
  });
});

describe('Gate 3 · contact requests and payments (AC-07, TX-13)', () => {
  let reqId: string;
  const body = () => ({ publicationId: nichaPub, purpose: 'ขอเป็นกรณีศึกษาของงานวิจัย และขอคำปรึกษาเรื่องการส่งต่อระบบ', scope: 'เกณฑ์คัดเลือกกรณีศึกษา', expiresAt: new Date(h.clock.now().getTime() + 14 * DAY).toISOString() });

  it('only verified organisations may ask; contact details stay hidden', async () => {
    const no = await h.call('POST', '/v1/contact-requests', { as: 'u_org2', body: body() });
    expect(no.status).toBe(403);
    const r = await h.call('POST', '/v1/contact-requests', { as: 'u_org', body: body() });
    expect(r.status).toBe(201);
    reqId = r.body.id;
    const org = await h.call('GET', '/v1/orgs/me/requests', { as: 'u_org' });
    expect(org.body.contacts[0]).toMatchObject({ status: 'REQUESTED', contact: null });
    expect(JSON.stringify(org.body)).not.toContain('@demo.ideax');
  });

  it('opens contact only after the owner accepts AND the unlock is paid, with a balanced ledger', async () => {
    const early = await h.call('POST', `/v1/contact-requests/${reqId}/pay`, { as: 'u_org' });
    expect(early.body.code).toBe('NOT_ACCEPTED');
    const acc = await h.call('POST', `/v1/contact-requests/${reqId}/accept`, { as: 'u_nicha', body: { disclose: ['email'] } });
    expect(acc.body.status).toBe('ACCEPTED');
    let org = await h.call('GET', '/v1/orgs/me/requests', { as: 'u_org' });
    expect(org.body.contacts[0].contact).toBeNull();
    const paid = await h.call('POST', `/v1/contact-requests/${reqId}/pay`, { as: 'u_org' });
    expect(paid.body.status).toBe('UNLOCKED');
    org = await h.call('GET', '/v1/orgs/me/requests', { as: 'u_org' });
    expect(org.body.contacts[0].contact).toEqual({ email: 'nicha@demo.ideax' });
    const [bal] = await h.db.query(`select sum(case when side = 'debit' then amount_satang else -amount_satang end)::int as diff, sum(case when side='debit' then amount_satang else 0 end)::int as total from ledger_entries`);
    expect(bal).toEqual({ diff: 0, total: 80_000 });
    const a = await h.db.query(`select reason from audit_log where object like 'ContactRequest%' and next = 'ACCEPTED'`);
    expect(a[0].reason).toContain('owner_consent');
  });

  it('needs the owner’s talent-matching consent to accept', async () => {
    const pub = await h.db.query(`select id from publications where owner_id = 'u_t1' and status = 'PUBLISHED'`);
    await h.call('POST', '/v1/consents/talent_matching/withdraw', { as: 'u_t1' });
    const r = await h.call('POST', '/v1/contact-requests', { as: 'u_org', body: { ...body(), publicationId: pub[0].id } });
    const acc = await h.call('POST', `/v1/contact-requests/${r.body.id}/accept`, { as: 'u_t1', body: {} });
    expect(acc.body.code).toBe('TALENT_CONSENT_REQUIRED');
    await h.call('POST', '/v1/consents/talent_matching/give', { as: 'u_t1' });
    expect((await h.call('POST', `/v1/contact-requests/${r.body.id}/accept`, { as: 'u_t1', body: {} })).body.status).toBe('ACCEPTED');
  });

  it('closes pending requests when talent-matching consent is withdrawn (TX-13)', async () => {
    const r = await h.call('POST', '/v1/contact-requests', { as: 'u_org', body: body() });
    await h.call('POST', '/v1/consents/talent_matching/withdraw', { as: 'u_nicha' });
    const [row] = await h.db.query('select status from contact_requests where id = $1', [r.body.id]);
    expect(row.status).toBe('DECLINED');
    await h.call('POST', '/v1/consents/talent_matching/give', { as: 'u_nicha' });
  });

  it('expires requests after their date', async () => {
    const r = await h.call('POST', '/v1/contact-requests', { as: 'u_org', body: { ...body(), expiresAt: new Date(h.clock.now().getTime() + DAY).toISOString() } });
    h.clock.advance(2 * DAY);
    const acc = await h.call('POST', `/v1/contact-requests/${r.body.id}/accept`, { as: 'u_nicha', body: {} });
    expect(acc.body.code).toBe('WRONG_STATUS');
    const mine = await h.call('GET', '/v1/me/requests', { as: 'u_nicha' });
    expect(mine.body.contacts.find((c: any) => c.id === r.body.id).status).toBe('EXPIRED');
  });

  it('idea purchase: owner approves before any money moves; learner gets 40%', async () => {
    const e = await h.call('POST', '/v1/engagements', { as: 'u_org', body: { publicationId: nichaPub, option: 'ขออ่านฉบับเต็ม', amountBaht: 500 } });
    expect(e.body.status).toBe('DISCUSSION');
    const early = await h.call('POST', `/v1/engagements/${e.body.id}/pay`, { as: 'u_org' });
    expect(early.body.code).toBe('NOT_AGREED');
    const wrong = await h.call('POST', `/v1/engagements/${e.body.id}/approve`, { as: 'u_joe' });
    expect(wrong.status).toBe(403);
    expect((await h.call('POST', `/v1/engagements/${e.body.id}/approve`, { as: 'u_nicha' })).body.status).toBe('AGREED');
    expect((await h.call('POST', `/v1/engagements/${e.body.id}/pay`, { as: 'u_org' })).body.status).toBe('PAID');
    const payouts = await h.call('GET', '/v1/me/payouts', { as: 'u_nicha' });
    expect(payouts.body.totalBaht).toBe(200);
  });

  it('does not sell commercial rights on Tier C works', async () => {
    await h.db.query(`update search_index set doc = jsonb_set(doc, '{tier}', '"C"') where publication_id = $1`, [nichaPub]);
    const r = await h.call('POST', '/v1/engagements', { as: 'u_org', body: { publicationId: nichaPub, option: 'สิทธิ์เชิงพาณิชย์', amountBaht: 6500 } });
    expect(r.body.code).toBe('TIER_NOT_ELIGIBLE');
    await h.db.query(`update search_index set doc = jsonb_set(doc, '{tier}', '"B"') where publication_id = $1`, [nichaPub]);
  });
});

describe('Gate 3 · shortlist, trends and withdrawal (AC-08)', () => {
  it('keeps team notes private to the organisation', async () => {
    await h.call('POST', '/v1/orgs/me/shortlist', { as: 'u_org', body: { publicationId: nichaPub, note: 'เหมาะกับโครงการรุ่นสาม' } });
    const d = await h.call('GET', `/v1/market/publications/${nichaPub}`, { as: 'u_org' });
    expect(d.body).toMatchObject({ shortlisted: true, note: 'เหมาะกับโครงการรุ่นสาม' });
    const owner = await h.call('GET', '/v1/me/publications', { as: 'u_nicha' });
    expect(JSON.stringify(owner.body)).not.toContain('เหมาะกับโครงการรุ่นสาม');
  });

  it('counts trends from the system’s own events', async () => {
    const t = await h.call('GET', '/v1/market/trends', { as: 'u_org' });
    expect(t.body.counts.searches).toBeGreaterThan(0);
    expect(t.body.topQueries.length).toBeGreaterThan(0);
  });

  it('withdrawal removes the work from search, closes the URL with 410 and closes pending requests', async () => {
    const pending = await h.call('POST', '/v1/contact-requests', { as: 'u_org', body: { publicationId: nichaPub, purpose: 'ขอคุยต่อเรื่องงานวิจัยอีกรอบ', scope: 'สั้น ๆ', expiresAt: new Date(h.clock.now().getTime() + 5 * DAY).toISOString() } });
    const w = await h.call('POST', `/v1/publications/${nichaPub}/withdraw`, { as: 'u_nicha' });
    expect(w.body.status).toBe('WITHDRAWN');
    expect((await search('ผู้สืบทอดรุ่นสอง')).body.results.some((r: any) => r.id === nichaPub)).toBe(false);
    expect((await h.call('GET', `/v1/public/publications/${nichaPub}`)).status).toBe(410);
    expect((await h.call('GET', `/v1/market/publications/${nichaPub}`, { as: 'u_org' })).status).toBe(404);
    const sl = await h.call('GET', '/v1/orgs/me/shortlist', { as: 'u_org' });
    expect(sl.body.items.find((i: any) => i.publicationId === nichaPub)).toMatchObject({ withdrawn: true, card: null });
    const [row] = await h.db.query('select status from contact_requests where id = $1', [pending.body.id]);
    expect(row.status).toBe('DECLINED');
  });
});
