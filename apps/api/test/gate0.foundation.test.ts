import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';
import { splitSentences, wordCount } from '../src/core/text.js';
import { signToken, verifyToken } from '../src/core/auth.js';

let h: Harness;
beforeAll(async () => {
  h = await makeHarness();
});
afterAll(async () => h.close());

const adult = {
  name: 'ทดสอบ ผู้ใหญ่',
  email: 'adult@test.th',
  birthYear: 2004,
  institution: 'มหาวิทยาลัยทดสอบ',
  province: 'ขอนแก่น',
  phone: '0812345678',
  consents: ['tos', 'confidentiality', 'pdpa_ai'],
};

describe('Gate 0 · text utilities', () => {
  it('counts Thai and English words', () => {
    expect(wordCount('ธุรกิจครอบครัวไทย')).toBeGreaterThanOrEqual(2);
    expect(wordCount('Three distinct bodies of literature.')).toBe(5);
  });
  it('splits sentences without breaking "et al." and remembers the section', () => {
    const doc = '2.2 Three bodies\nThe first concerns succession (Nordqvist et al., 2013). The second is TAM.';
    const s = splitSentences(doc);
    expect(s).toHaveLength(2);
    expect(s[0].text).toContain('et al., 2013)');
    expect(s[0].section).toBe('§2.2');
    expect(doc.slice(s[1].start, s[1].end)).toBe('The second is TAM.');
  });
  it('rejects tampered tokens', () => {
    const t = signToken('u_teacher');
    expect(verifyToken(t)).toBe('u_teacher');
    expect(verifyToken(t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')))).toBeNull();
  });
});

describe('Gate 0 · signup and consent (plan appendix B)', () => {
  it('refuses signup without the 3 mandatory consents', async () => {
    const r = await h.call('POST', '/v1/auth/signup', { body: { ...adult, consents: ['tos'] } });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('CONSENT_REQUIRED');
    expect(r.body.details.missing).toEqual(['confidentiality', 'pdpa_ai']);
  });

  it('creates an adult learner, records each consent and audits it', async () => {
    const r = await h.call('POST', '/v1/auth/signup', { body: adult });
    expect(r.status).toBe(201);
    expect(r.body.guardianRequired).toBe(false);
    const me = await h.call('GET', '/v1/me', { token: r.body.token });
    expect(me.body.consents).toMatchObject({ tos: true, confidentiality: true, pdpa_ai: true, talent_matching: false });
    expect(me.body.guardianConfirmed).toBe(true);
    const audit = await h.db.query(`select * from audit_log where object like 'User · ทดสอบ ผู้ใหญ่'`);
    expect(audit[0].next).toBe('REGISTERED');
    expect(audit[0].correlation_id).toMatch(/^cid-/);
  });

  it('rejects a duplicate e-mail with 409', async () => {
    const r = await h.call('POST', '/v1/auth/signup', { body: adult });
    expect(r.status).toBe(409);
  });

  it('requires a guardian phone for learners under 20 (TX-12)', async () => {
    const r = await h.call('POST', '/v1/auth/signup', { body: { ...adult, email: 'minor@test.th', birthYear: 2010 } });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('GUARDIAN_PHONE_REQUIRED');
  });

  it('confirms guardian consent only with the right OTP, and locks after 5 wrong tries', async () => {
    const r = await h.call('POST', '/v1/auth/signup', { body: { ...adult, email: 'minor2@test.th', birthYear: 2010, guardianPhone: '0899999999' } });
    expect(r.status).toBe(201);
    expect(r.body.guardianRequired).toBe(true);
    const token = r.body.token;
    let me = await h.call('GET', '/v1/me', { token });
    expect(me.body.guardianConfirmed).toBe(false);

    const wrong = await h.call('POST', '/v1/consents/guardian/confirm', { token, body: { code: r.body.devOtp === '000000' ? '111111' : '000000' } });
    expect(wrong.body.code).toBe('OTP_INVALID');
    const ok = await h.call('POST', '/v1/consents/guardian/confirm', { token, body: { code: r.body.devOtp } });
    expect(ok.status).toBe(200);
    me = await h.call('GET', '/v1/me', { token });
    expect(me.body.guardianConfirmed).toBe(true);

    const r2 = await h.call('POST', '/v1/auth/signup', { body: { ...adult, email: 'minor3@test.th', birthYear: 2010, guardianPhone: '0899999998' } });
    const bad = r2.body.devOtp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await h.call('POST', '/v1/consents/guardian/confirm', { token: r2.body.token, body: { code: bad } });
    const locked = await h.call('POST', '/v1/consents/guardian/confirm', { token: r2.body.token, body: { code: r2.body.devOtp } });
    expect(locked.body.code).toBe('OTP_LOCKED');
  });

  it('rejects an expired OTP', async () => {
    const r = await h.call('POST', '/v1/auth/signup', { body: { ...adult, email: 'minor4@test.th', birthYear: 2010, guardianPhone: '0899999997' } });
    h.clock.advance(11 * 60 * 1000);
    const res = await h.call('POST', '/v1/consents/guardian/confirm', { token: r.body.token, body: { code: r.body.devOtp } });
    expect(res.body.code).toBe('OTP_EXPIRED');
  });

  it('lets a learner give and withdraw the optional talent-matching consent (ledger keeps both)', async () => {
    const give = await h.call('POST', '/v1/consents/talent_matching/give', { as: 'u_thanawat' });
    expect(give.body.consents.talent_matching).toBe(true);
    const wd = await h.call('POST', '/v1/consents/talent_matching/withdraw', { as: 'u_thanawat' });
    expect(wd.body.consents.talent_matching).toBe(false);
    const rows = await h.db.query(`select action from consent_records where user_id = 'u_thanawat' and code = 'talent_matching' order by seq`);
    expect(rows.map((r) => r.action)).toEqual(['given', 'withdrawn']);
  });
});

describe('Gate 0 · audit is append-only', () => {
  it('blocks UPDATE and DELETE on audit_log, trace_events and consent_records', async () => {
    for (const t of ['audit_log', 'trace_events', 'consent_records']) {
      await expect(h.db.query(`delete from ${t}`)).rejects.toThrow(/append-only/);
    }
    await expect(h.db.query(`update audit_log set reason = 'x'`)).rejects.toThrow(/append-only/);
  });

  it('shows staff the whole log but a learner only their own rows', async () => {
    const staff = await h.call('GET', '/v1/audit', { as: 'u_teacher' });
    const learner = await h.call('GET', '/v1/audit', { as: 'u_thanawat' });
    expect(staff.body.rows.length).toBeGreaterThan(learner.body.rows.length);
    expect(learner.body.rows.every((r: any) => r.actor_id === 'u_thanawat')).toBe(true);
  });
});

describe('Gate 0 · HTTP contract', () => {
  it('echoes a valid correlation id and hides internal errors', async () => {
    const r = await h.call('GET', '/v1/health', { headers: { 'x-correlation-id': 'cid-abc123' } });
    expect(r.headers['x-correlation-id']).toBe('cid-abc123');
    const unauth = await h.call('GET', '/v1/me');
    expect(unauth.status).toBe(401);
    expect(unauth.body).toMatchObject({ code: 'UNAUTHENTICATED', message_th: expect.any(String) });
  });

  it('returns 400 VALIDATION for malformed bodies', async () => {
    const r = await h.call('POST', '/v1/auth/signup', { body: { name: '' } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION');
  });

  it('marks students verified after card upload, only for learners', async () => {
    const ok = await h.call('POST', '/v1/identity/student-card', { as: 'u_noey', body: { fileName: 'card.jpg' } });
    expect(ok.body.studentCardVerified).toBe(true);
    const no = await h.call('POST', '/v1/identity/student-card', { as: 'u_teacher', body: { fileName: 'card.jpg' } });
    expect(no.status).toBe(403);
  });
});
