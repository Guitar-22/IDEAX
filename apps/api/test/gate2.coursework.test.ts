import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';
import { ASSIGNMENT_ID, COURSE_ID, seedIdeaxCatalog, seedIdeaxSubmissions } from '../src/seed/ideax.js';
import { CHAPTER_V4 } from '../src/seed/ideax-data.js';

let h: Harness;
beforeAll(async () => {
  h = await makeHarness({
    seed: async (d) => {
      await seedIdeaxCatalog(d);
      await seedIdeaxSubmissions(d);
      await d.db.query(`insert into enrollments(course_id, user_id) values ($1, 'u_joe')`, [COURSE_ID]);
    },
  });
});
afterAll(async () => h.close());

const JOE_TEXT = '2.1 Introduction\nSmall cafés in Khon Kaen lose regulars when prices rise. This chapter reviews prior research on price sensitivity.\n\n2.2 Literature\nPrior research separates loyal and casual buyers (Smith, 2019).';

describe('Gate 2 · coursework: tasks and assignment', () => {
  it('shows only the learner’s own enrollments, by due date, with server time', async () => {
    const r = await h.call('GET', '/v1/me/tasks', { as: 'u_joe' });
    expect(r.body.tasks).toHaveLength(1);
    expect(r.body.tasks[0]).toMatchObject({ id: ASSIGNMENT_ID, submission_id: null });
    expect(r.body.serverTime).toBe(h.clock.now().toISOString());
    const outsider = await h.call('GET', `/v1/assignments/${ASSIGNMENT_ID}`, { as: 'u_noey' });
    expect(outsider.status).toBe(403);
  });

  it('shows the rubric in its original wording and says weights are equal (AC-04)', async () => {
    const r = await h.call('GET', `/v1/assignments/${ASSIGNMENT_ID}`, { as: 'u_joe' });
    expect(r.body.rubric.criteria).toHaveLength(4);
    expect(r.body.rubric.criteria[0].items[0].text).toMatch(/^The research has a distinct starting point/);
    expect(r.body.rubric.weighting).toBe('equal');
    expect(r.body.canSubmit).toBe(true);
  });
});

describe('Gate 2 · coursework: precheck, disclosure, submit (AC-01)', () => {
  it('blocks submit until an AI disclosure is saved', async () => {
    const r = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/submissions`, { as: 'u_joe', body: { content: JOE_TEXT } });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('DISCLOSURE_REQUIRED');
  });

  it('precheck is advisory: named findings, no percentage, nothing official', async () => {
    const r = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/precheck`, { as: 'u_joe', body: { content: JOE_TEXT } });
    expect(r.status).toBe(200);
    expect(r.body.advisory).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/\d+\s?%/);
    const titles = r.body.results.map((x: any) => x.title);
    expect(titles).toContain('ยังไม่ได้กรอกการใช้ AI');
    expect(r.body.results.find((x: any) => x.item === '1.3').level).toBe('attention');
    const official = await h.db.query(`select count(*)::int as n from submissions where student_id = 'u_joe'`);
    expect(official[0].n).toBe(0);
  });

  it('requires a precheck after the disclosure is saved, then issues a receipt at once', async () => {
    const d = await h.call('PUT', `/v1/assignments/${ASSIGNMENT_ID}/disclosure`, { as: 'u_joe', body: { tool: 'ไม่ได้ใช้', part: '-', confirmed: true } });
    expect(d.status).toBe(200);
    const s = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/submissions`, { as: 'u_joe', body: { content: JOE_TEXT } });
    expect(s.status).toBe(201);
    expect(s.body.receipt.id).toMatch(/^RCP-\d{8}-\d{6}$/);
    expect(s.body.receipt.receivedAt).toBe(h.clock.now().toISOString());
    expect(s.body.analysis).toBe('QUEUED');
    await h.queue.drain();
    const sub = await h.call('GET', `/v1/submissions/${s.body.submissionId}`, { as: 'u_joe' });
    expect(sub.body.versions[0]).toMatchObject({ version_no: 1, analysis: 'COMPLETED', released: false });
  });

  it('refuses a second version while the first is still under review', async () => {
    const sub = (await h.db.query(`select id from submissions where student_id = 'u_joe'`))[0];
    await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/precheck`, { as: 'u_joe', body: { content: JOE_TEXT } });
    const r = await h.call('POST', `/v1/submissions/${sub.id}/versions`, { as: 'u_joe', body: { content: JOE_TEXT + ' More.' } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NOT_OPEN_FOR_REVISION');
  });

  it('keeps the receipt when AI is down; analysis status is shown separately (AC-01)', async () => {
    await h.db.query(`insert into enrollments(course_id, user_id) values ($1, 'u_noey')`, [COURSE_ID]);
    await h.call('PUT', `/v1/assignments/${ASSIGNMENT_ID}/disclosure`, { as: 'u_noey', body: { tool: 'ไม่ได้ใช้', part: '-', confirmed: true } });
    h.ai.setDown(true);
    try {
      const pre = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/precheck`, { as: 'u_noey', body: { content: JOE_TEXT } });
      expect(pre.body.results.some((x: any) => x.title.includes('ระบบช่วยตรวจไม่พร้อม'))).toBe(true);
      const s = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/submissions`, { as: 'u_noey', body: { content: JOE_TEXT } });
      expect(s.status).toBe(201);
      expect(s.body.receipt.id).toMatch(/^RCP-/);
      await h.queue.drain();
      const sub = await h.call('GET', `/v1/submissions/${s.body.submissionId}`, { as: 'u_noey' });
      expect(sub.body.versions[0].analysis).toBe('ABANDONED');
      expect(sub.body.submission.status).toBe('SUBMITTED');
    } finally {
      h.ai.setDown(false);
    }
  });
});

describe('Gate 2 · coursework: feedback and revision', () => {
  let subId: string;
  it('learner reads only the released result, then revises and keeps version 1', async () => {
    subId = (await h.db.query(`select id from submissions where student_id = 'u_nicha'`))[0].id;
    const v1 = (await h.db.query(`select id from submission_versions where submission_id = $1`, [subId]))[0].id;
    // teacher decides everything and releases for revision
    let r = await h.call('GET', `/v1/reviews/${v1}`, { as: 'u_teacher' });
    for (const c of r.body.criteria) await h.call('POST', `/v1/reviews/${v1}/criteria/${c.id}/accept`, { as: 'u_teacher' });
    r = await h.call('GET', `/v1/reviews/${v1}`, { as: 'u_teacher' });
    for (const i of r.body.items.filter((x: any) => x.status === 'NO_PROPOSAL')) {
      await h.call('POST', `/v1/reviews/${v1}/items/${i.no}/decision`, { as: 'u_teacher', body: { action: 'flag', codes: ['D'], rowVersion: i.rowVersion } });
    }
    const rel = await h.call('POST', `/v1/reviews/${v1}/release`, { as: 'u_teacher', body: { mode: 'revise' } });
    expect(rel.status).toBe(200);

    const fb = await h.call('GET', `/v1/submissions/${subId}/feedback`, { as: 'u_nicha' });
    expect(fb.body.status).toBe('REVISION_REQUIRED');
    expect(fb.body.criteria.flatMap((c: any) => c.items).find((i: any) => i.no === '3.2')).toMatchObject({ status: 'RETURNED_FOR_REVISION', grade: null });

    h.clock.advance(60 * 60 * 1000); // an hour later the learner comes back to revise
    const noPre = await h.call('POST', `/v1/submissions/${subId}/versions`, { as: 'u_nicha', body: { content: CHAPTER_V4 } });
    expect(noPre.body.code).toBe('PRECHECK_REQUIRED');
    const pre = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/precheck`, { as: 'u_nicha', body: { content: CHAPTER_V4 } });
    expect(pre.body.results.filter((x: any) => x.item === '1.3' || x.item === '3.2').every((x: any) => x.level === 'ok')).toBe(true);
    const v2 = await h.call('POST', `/v1/submissions/${subId}/versions`, { as: 'u_nicha', body: { content: CHAPTER_V4, revisionNote: 'เพิ่มประโยค gap และแปลงรูปเป็นตาราง' } });
    expect(v2.status).toBe(201);
    expect(v2.body.receipt.versionNo).toBe(2);
    await h.queue.drain();

    const versions = await h.db.query('select version_no, sha256 from submission_versions where submission_id = $1 order by version_no', [subId]);
    expect(versions).toHaveLength(2);
    expect(versions[0].sha256).not.toBe(versions[1].sha256);
    const review = await h.call('GET', `/v1/reviews/${v2.body.versionId}`, { as: 'u_teacher' });
    expect(review.body.items.find((i: any) => i.no === '1.3')).toMatchObject({ status: 'AI_PROPOSED', kind: 'presence' });
    expect(review.body.items.find((i: any) => i.no === '3.2')).toMatchObject({ status: 'AI_PROPOSED', kind: 'presence' });

    // the released result of version 1 is still what the learner sees until version 2 is released
    const fb2 = await h.call('GET', `/v1/submissions/${subId}/feedback`, { as: 'u_nicha' });
    expect(fb2.body.versionNo).toBe(1);
  });

  it('asks understanding questions from the learner’s own work and hides the AI judgement from them', async () => {
    const q = await h.call('GET', `/v1/assignments/${ASSIGNMENT_ID}/verification`, { as: 'u_nicha' });
    expect(q.body.versionNo).toBe(2);
    expect(q.body.questions.length).toBeGreaterThan(0);
    expect(q.body.questions[0].question).toMatch(/^คุณเขียนว่า “/);
    const a = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/verification/1`, {
      as: 'u_nicha',
      body: { answer: 'เพราะข้อมูลจากการสัมภาษณ์ผู้สืบทอด 12 รายชี้ว่าระบบเดิมกำหนดสิ่งที่เขาทำได้ ถ้าเงื่อนไขเปลี่ยนจะเลือกศึกษาเชิงปริมาณแทน' },
    });
    expect(a.body).toEqual({ saved: true });
    const again = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/verification/1`, { as: 'u_nicha', body: { answer: 'x' } });
    expect(again.body.code).toBe('ALREADY_ANSWERED');
    const sv2 = (await h.db.query(`select id from submission_versions where submission_id = $1 and version_no = 2`, [subId]))[0].id;
    const teacher = await h.call('GET', `/v1/reviews/${sv2}`, { as: 'u_teacher' });
    expect(teacher.body.verification[0]).toMatchObject({ explained: true });
  });

  it('keeps AI use inside the platform: Socratic replies, recorded, 503 when AI is down (TX-19)', async () => {
    const r = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/ai-chat`, { as: 'u_nicha', body: { text: 'ช่วยเขียนประโยค gap ให้หน่อย' } });
    expect(r.body.reply).toMatch(/\?/);
    expect(r.body.reply).not.toContain('What the succession literature');
    const hist = await h.call('GET', `/v1/assignments/${ASSIGNMENT_ID}/ai-chat`, { as: 'u_nicha' });
    expect(hist.body.messages.map((m: any) => m.role)).toEqual(['student', 'ai']);
    h.ai.setDown(true);
    const down = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/ai-chat`, { as: 'u_nicha', body: { text: 'อีกข้อ' } });
    h.ai.setDown(false);
    expect(down.status).toBe(503);
    expect(down.body.code).toBe('AI_UNAVAILABLE');
  });

  it('records verification-mode integrity events without penalising (TX-20)', async () => {
    const r = await h.call('POST', `/v1/assignments/${ASSIGNMENT_ID}/integrity-events`, { as: 'u_nicha', body: { type: 'paste.blocked' } });
    expect(r.body.recorded).toBe(true);
    const sub = await h.db.query(`select status from submissions where student_id = 'u_nicha'`);
    expect(sub[0].status).toBe('RESUBMITTED');
  });

  it('never lets one learner read another learner’s submission', async () => {
    const r = await h.call('GET', `/v1/submissions/${subId}`, { as: 'u_joe' });
    expect(r.status).toBe(403);
  });
});
