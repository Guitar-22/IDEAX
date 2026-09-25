import { expect } from 'vitest';
import type { Harness } from './helpers.js';
import { QUIZ } from '../src/modules/thaitern/curriculum.js';

export const STRONG_CANVAS = {
  problem: 'ต้นเหตุคือสาขาจามจุรีหมักโยเกิร์ตเท่ากันทุกวัน ทำให้ของเสียช่วงบ่ายสูงถึง 18% เพราะลูกค้าบ่ายน้อยและสั่งแก้ว S',
  target: 'นิสิตที่มาเป็นกลุ่มช่วงบ่าย 14:00–17:00 ซึ่งตอนนี้สั่งแก้ว S เป็นหลัก',
  unit_economics: 'ขายแก้วละ 65 บาท ต้นทุนผันแปร 26 บาท เหลือ 39 บาทต่อแก้ว ของเสีย 18% กินกำไรราว 8,000 บาทต่อเดือน',
  channels: 'ใช้เพจร้านประกาศโปรช่วงบ่าย และป้ายหน้าร้านจามจุรี',
  risks: 'ความเสี่ยงคือโปรทำให้กำไรต่อแก้วลด ถ้ายอดบ่ายไม่เพิ่ม 15% ภายใน 4 สัปดาห์ให้หยุด',
};
export const STRONG_ANSWERS = {
  q1: 'ต้นเหตุคือการหมักรอบเดียวที่สาขาจามจุรี ข้อมูลของเสียเพิ่มจาก 11% เป็น 18% ขณะที่บรรทัดทองคงที่ 4–5% ทำให้กำไรลดแม้ยอดขายรวมเพิ่ม',
  q2: 'ทางเลือกคือหมักสองรอบที่จามจุรีแทนการลดราคา เปรียบเทียบแล้วความเสี่ยงต่ำกว่า วัดผลด้วยของเสียต่ำกว่า 8% และกำไรเดือนละ 8,000 บาทที่กลับมา',
};
export const WEAK = { text: 'ควรทำการตลาดให้มากขึ้นและทำเมนูใหม่ให้น่าสนใจ ลูกค้าจะได้เยอะขึ้น' };

/** Creates a verified adult learner with the mandatory consents. */
export async function makeLearner(h: Harness, id: string, opts: { talent?: boolean } = {}) {
  await h.db.query(`insert into users(id, name, email, role, birth_year, student_card_verified) values ($1, $2, $3, 'learner', 2004, true)`, [id, `ผู้เรียน ${id}`, `${id}@test.th`]);
  for (const c of ['tos', 'confidentiality', 'pdpa_ai', ...(opts.talent ? ['talent_matching'] : [])]) {
    await h.db.query(`insert into consent_records(user_id, code, text_version, action, channel) values ($1, $2, 'v', 'given', 'test')`, [id, c]);
  }
}

/** Walks one learner (or an existing team) from choosing a case to a submitted, screened work. */
export async function driveToSubmitted(h: Harness, user: string, caseId: string, opts: { strong?: boolean; teamId?: string } = {}) {
  const strong = opts.strong ?? true;
  const c = await h.call('POST', '/v1/attempts', { as: user, body: { caseId, teamId: opts.teamId } });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const id: string = c.body.id;
  await h.call('PUT', `/v1/attempts/${id}/first-draft`, { as: user, body: { text: 'ร่างแรก: น่าจะเป็นเรื่องต้นทุนวัตถุดิบ', done: true } });
  const s = await h.call('GET', `/v1/attempts/${id}/sessions`, { as: user });
  for (const x of s.body.sessions) await h.call('POST', `/v1/attempts/${id}/sessions/${x.key}/complete`, { as: user });
  const track = c.body.case.track as 'sme' | 'community';
  const quiz = await h.call('POST', `/v1/attempts/${id}/quiz`, { as: user, body: { answers: Object.fromEntries(QUIZ[track].map((q) => [q.id, q.answer])) } });
  const un = await h.call('POST', `/v1/attempts/${id}/unlock`, { as: user, body: { code: quiz.body.attempt.unlock.devAccessCode } });
  expect(un.body.state, JSON.stringify(un.body)).toBe('IN_PROGRESS');
  for (const k of Object.keys(STRONG_CANVAS)) {
    await h.call('PUT', `/v1/attempts/${id}/canvas/${k}`, { as: user, body: { text: strong ? (STRONG_CANVAS as any)[k] : WEAK.text } });
  }
  await h.call('POST', `/v1/attempts/${id}/pushback/start`, { as: user });
  const p = await h.call('POST', `/v1/attempts/${id}/pushback/respond`, {
    as: user,
    body: { defense: 'ข้อมูลใน Data Room แสดงว่าของเสียจามจุรีเพิ่มจาก 11% เป็น 18% ขณะที่บรรทัดทองคงที่ 4–5% ต้นเหตุจึงอยู่ที่การหมักรอบเดียว ไม่ใช่ราคา' },
  });
  expect(p.body.passed).toBe(true);
  const answers = strong ? STRONG_ANSWERS : { q1: WEAK.text, q2: WEAK.text };
  const sub = await h.call('POST', `/v1/attempts/${id}/submit`, { as: user, body: { answers, summary: strong ? 'สรุป: หมักสองรอบที่จามจุรี ลดของเสียจาก 18% เหลือต่ำกว่า 8% กำไรกลับมาเดือนละ 8,000 บาท' : WEAK.text } });
  expect(sub.status).toBe(201);
  await h.queue.drain();
  const [row] = await h.db.query('select id, shortlisted, ai_bands from attempt_submissions where attempt_id = $1', [id]);
  return { attemptId: id, submissionId: row.id as string, shortlisted: row.shortlisted as boolean | null, aiBands: row.ai_bands as Array<{ key: string; band: number }> };
}
