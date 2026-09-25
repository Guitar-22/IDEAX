import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';
import { ASSIGNMENT_ID, COURSE_ID, seedIdeaxCatalog, seedIdeaxSubmissions } from '../src/seed/ideax.js';
import { anchorHash } from '../src/ai/mock.js';
import { insightGroup, summarize } from '../src/modules/ideax/service.js';
import { submitVersion } from '../src/modules/ideax/service.js';
import { gradeValue } from '@ideax/contracts';
import type { UserRow } from '../src/core/http.js';

let h: Harness;
let sv: string; // ณิชา v1

beforeAll(async () => {
  h = await makeHarness({
    seed: async (d) => {
      await seedIdeaxCatalog(d);
      await seedIdeaxSubmissions(d);
    },
  });
  const q = await h.call('GET', '/v1/teacher/queue', { as: 'u_teacher' });
  sv = q.body.queue.find((r: any) => r.student_id === 'u_nicha').version_id;
});
afterAll(async () => h.close());

const review = (as = 'u_teacher', id = sv) => h.call('GET', `/v1/reviews/${id}`, { as });
const item = async (no: string, id = sv) => (await review('u_teacher', id)).body.items.find((i: any) => i.no === no);
const decide = (no: string, body: any, as = 'u_teacher', id = sv) => h.call('POST', `/v1/reviews/${id}/items/${no}/decision`, { as, body });

describe('Gate 1 · pure rules', () => {
  it('averages only verified items, equal weights, returned items never count as F (AC-04)', () => {
    const s = summarize([
      { item_no: '1.1', criterion_id: 'C1', status: 'VERIFIED', grade: 'A' },
      { item_no: '1.2', criterion_id: 'C1', status: 'VERIFIED', grade: 'C' },
      { item_no: '1.3', criterion_id: 'C1', status: 'RETURNED_FOR_REVISION', grade: null },
      { item_no: '2.1', criterion_id: 'C2', status: 'AI_PROPOSED', grade: 'B' },
    ]);
    expect(s.average).toBe(3);
    expect(s.byCriterion).toEqual({ C1: 3, C2: null });
    expect(s).toMatchObject({ verified: 2, returned: 1, pending: 1 });
  });

  it('puts every learner in exactly one insight group, never guessing without evidence', () => {
    const base = { passMark: 3, verification: true, answered: 2, explained: 2, returned: 0 };
    expect(insightGroup({ ...base, verifiedCount: 0, average: null })).toBe('insufficient');
    expect(insightGroup({ ...base, verifiedCount: 10, average: 2.5 })).toBe('needs_feedback');
    expect(insightGroup({ ...base, verifiedCount: 10, average: 3.4, returned: 1 })).toBe('needs_feedback');
    expect(insightGroup({ ...base, verifiedCount: 10, average: 3.4 })).toBe('understood');
    expect(insightGroup({ ...base, verifiedCount: 10, average: 3.4, explained: 1 })).toBe('cannot_explain');
    expect(insightGroup({ ...base, verifiedCount: 10, average: 3.4, answered: 0, explained: 0 })).toBe('insufficient');
  });
});

describe('Gate 1 · queue and access', () => {
  it('lists the course submissions for the instructor and the enrolled marker, not for learners', async () => {
    const t = await h.call('GET', '/v1/teacher/queue', { as: 'u_teacher' });
    expect(t.body.queue).toHaveLength(2);
    expect(t.body.queue.every((r: any) => r.analysis_status === 'COMPLETED' && r.items_total === 16)).toBe(true);
    const m = await h.call('GET', '/v1/teacher/queue', { as: 'u_marker' });
    expect(m.body.queue).toHaveLength(2);
    const s = await h.call('GET', '/v1/teacher/queue', { as: 'u_nicha' });
    expect(s.status).toBe(403);
    const other = await h.call('GET', `/v1/reviews/${sv}`, { as: 'u_owner' });
    expect(other.status).toBe(403);
  });

  it('shows 16 items with AI proposals in blue and 3 items that need a human (AC-10)', async () => {
    const r = await review();
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(16);
    const none = r.body.items.filter((i: any) => i.status === 'NO_PROPOSAL').map((i: any) => i.no);
    expect(none).toEqual(['2.4', '3.2', '4.4']);
    expect(r.body.items.find((i: any) => i.no === '3.2').reasonCode).toBe('extraction_gap');
    expect(r.body.items.find((i: any) => i.no === '1.3')).toMatchObject({ status: 'AI_PROPOSED', aiGrade: 'D+', kind: 'absence' });
    expect(r.body.rubric.weighting).toBe('equal');
    expect(r.body.diagnostics.some((d: any) => d.kind === 'extraction_gap' && d.detail.includes('AC-10'))).toBe(true);
    expect(r.body.canRelease).toBe(true);
    expect((await review('u_marker')).body.canRelease).toBe(false);
  });

  it('only shows anchors that point at the exact text they claim (AC-03)', async () => {
    const r = await review();
    const content: string = r.body.version.content;
    const rows = await h.db.query('select start_offset, end_offset, hash from anchors where submission_version_id = $1', [sv]);
    expect(rows.length).toBeGreaterThan(5);
    for (const a of rows) expect(anchorHash(content.slice(a.start_offset, a.end_offset))).toBe(a.hash);
  });
});

describe('Gate 1 · human decisions', () => {
  it('accepts a proposal and audits AI value → human value', async () => {
    const it0 = await item('1.1');
    const r = await decide('1.1', { action: 'accept', rowVersion: it0.rowVersion });
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ status: 'VERIFIED', grade: it0.aiGrade, decidedBy: 'ผศ.ดร. กมลชนก วีรกุล' });
    const [a] = await h.db.query(`select * from audit_log where object like '%ข้อ 1.1' order by id desc limit 1`);
    expect(a).toMatchObject({ prev: `AI_PROPOSED ${it0.aiGrade}`, next: `VERIFIED ${it0.aiGrade}`, reason: 'accept_proposal', role: 'thesis_mentor' });
    const s = await h.db.query(`select status from submissions where student_id = 'u_nicha'`);
    expect(s[0].status).toBe('IN_REVIEW');
  });

  it('requires a one-line reason when the grade differs from the proposal', async () => {
    const it0 = await item('1.2');
    const bad = await decide('1.2', { action: 'grade', grade: 'B', rowVersion: it0.rowVersion });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('REASON_REQUIRED');
    const ok = await decide('1.2', { action: 'grade', grade: 'B', reason: 'แยกกลุ่มได้ แต่ยังไม่เล่าว่าแต่ละกลุ่มรู้อะไรแล้ว', rowVersion: it0.rowVersion });
    expect(ok.body.item).toMatchObject({ status: 'VERIFIED', grade: 'B', aiGrade: it0.aiGrade });
  });

  it('grades an item with no proposal only with a reason, marked human_only', async () => {
    const it0 = await item('3.2');
    expect(it0.aiGrade).toBeNull();
    expect((await decide('3.2', { action: 'grade', grade: 'C', rowVersion: it0.rowVersion })).body.code).toBe('REASON_REQUIRED');
    const ok = await decide('3.2', { action: 'grade', grade: 'C', reason: 'เปิดดู Figure 2.1 จากไฟล์ต้นฉบับแล้ว', rowVersion: it0.rowVersion });
    expect(ok.body.item.status).toBe('VERIFIED');
    const [a] = await h.db.query(`select next from audit_log where object like '%ข้อ 3.2' order by id desc limit 1`);
    expect(a.next).toBe('VERIFIED C · human_only');
  });

  it('refuses to accept an item that has no proposal', async () => {
    const it0 = await item('4.4');
    const r = await decide('4.4', { action: 'accept', rowVersion: it0.rowVersion });
    expect(r.body.code).toBe('NO_PROPOSAL_TO_ACCEPT');
  });

  it('returns an item for revision with no grade, which does not lower the average', async () => {
    const before = (await review()).body.summary.average;
    const it0 = await item('1.3');
    const noReason = await decide('1.3', { action: 'flag', rowVersion: it0.rowVersion });
    expect(noReason.body.code).toBe('FLAG_REASON_REQUIRED');
    const r = await decide('1.3', { action: 'flag', codes: ['J'], reason: 'เพิ่มประโยค gap ท้าย §2.4', rowVersion: it0.rowVersion });
    expect(r.body.item).toMatchObject({ status: 'RETURNED_FOR_REVISION', grade: null, ann: ['J'] });
    expect(r.body.summary.average).toBe(before);
    expect(r.body.summary.returned).toBe(1);
  });

  it('does not let a second reviewer overwrite silently (AC-11)', async () => {
    const seenByTeacher = await item('1.4');
    const marker = await decide('1.4', { action: 'accept', rowVersion: seenByTeacher.rowVersion }, 'u_marker');
    expect(marker.status).toBe(200);
    const teacher = await decide('1.4', { action: 'grade', grade: 'A', reason: 'ดีมาก', rowVersion: seenByTeacher.rowVersion });
    expect(teacher.status).toBe(409);
    expect(teacher.body.code).toBe('REVIEW_CONFLICT');
    expect(teacher.body.details.theirs).toMatchObject({ status: 'VERIFIED', grade: seenByTeacher.aiGrade, decidedBy: 'อ.ดร. ธนกฤต แสงมณี' });
    expect((await item('1.4')).grade).toBe(seenByTeacher.aiGrade);
  });

  it('bulk-accepts the remaining proposals of one criterion as ONE decision', async () => {
    const auditBefore = (await h.db.query('select count(*)::int as n from audit_log'))[0].n;
    const r = await h.call('POST', `/v1/reviews/${sv}/criteria/C2/accept`, { as: 'u_teacher' });
    expect(r.status).toBe(200);
    expect(r.body.accepted).toEqual(['2.1', '2.2', '2.3']);
    expect(r.body.items.find((i: any) => i.no === '2.4').status).toBe('NO_PROPOSAL');
    const decisions = await h.db.query(`select item_nos from review_decisions where submission_version_id = $1 and action = 'bulk_accept'`, [sv]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].item_nos).toEqual(['2.1', '2.2', '2.3']);
    const auditAfter = (await h.db.query('select count(*)::int as n from audit_log'))[0].n;
    expect(auditAfter - auditBefore).toBe(1);
    const again = await h.call('POST', `/v1/reviews/${sv}/criteria/C2/accept`, { as: 'u_teacher' });
    expect(again.body.code).toBe('NOTHING_TO_ACCEPT');
  });

  it('undoes a decision back to the proposal, and re-deciding needs the fresh rowVersion', async () => {
    const it0 = await item('2.1');
    const r = await h.call('POST', `/v1/reviews/${sv}/items/2.1/undo`, { as: 'u_teacher', body: { rowVersion: it0.rowVersion } });
    expect(r.body.item).toMatchObject({ status: 'AI_PROPOSED', grade: it0.aiGrade });
    const stale = await decide('2.1', { action: 'accept', rowVersion: it0.rowVersion });
    expect(stale.status).toBe(409);
    const ok = await decide('2.1', { action: 'accept', rowVersion: r.body.item.rowVersion });
    expect(ok.status).toBe(200);
  });

  it('toggles U/D/J annotations', async () => {
    const r1 = await h.call('POST', `/v1/reviews/${sv}/items/3.4/annotations`, { as: 'u_teacher', body: { code: 'U' } });
    expect(r1.body.item.ann).toEqual(['U']);
    const r2 = await h.call('POST', `/v1/reviews/${sv}/items/3.4/annotations`, { as: 'u_teacher', body: { code: 'U' } });
    expect(r2.body.item.ann).toEqual([]);
  });
});

describe('Gate 1 · release (AC-12)', () => {
  it('learner sees nothing before release', async () => {
    const subId = (await h.db.query(`select id from submissions where student_id = 'u_nicha'`))[0].id;
    const r = await h.call('GET', `/v1/submissions/${subId}/feedback`, { as: 'u_nicha' });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_RELEASED');
  });

  it('refuses release while items are undecided, and refuses it to the marker', async () => {
    const r = await h.call('POST', `/v1/reviews/${sv}/release`, { as: 'u_teacher', body: { mode: 'revise' } });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('NOT_ALL_DECIDED');
    expect(r.body.details.pending.length).toBeGreaterThan(0);
    const m = await h.call('POST', `/v1/reviews/${sv}/release`, { as: 'u_marker', body: { mode: 'revise' } });
    expect(m.status).toBe(403);
  });

  it('releases an immutable snapshot with only human-confirmed content', async () => {
    let r = await review();
    for (const i of r.body.items.filter((x: any) => x.status === 'AI_PROPOSED')) {
      await decide(i.no, { action: 'accept', rowVersion: i.rowVersion });
    }
    r = await review();
    for (const i of r.body.items.filter((x: any) => x.status === 'NO_PROPOSAL')) {
      await decide(i.no, { action: 'flag', codes: ['D'], reason: 'ส่งส่วนที่ขาดมาด้วย', rowVersion: i.rowVersion });
    }
    const preview = await h.call('GET', `/v1/reviews/${sv}/release-preview`, { as: 'u_teacher' });
    expect(preview.body.pending).toEqual([]);

    const rel = await h.call('POST', `/v1/reviews/${sv}/release`, { as: 'u_teacher', body: { mode: 'revise', note: 'แก้ข้อ 1.3 และ 1.4 แล้วส่งใหม่' } });
    expect(rel.status).toBe(200);
    expect(rel.body.status).toBe('REVISION_REQUIRED');
    const text = JSON.stringify(rel.body.snapshot);
    expect(text).not.toContain('"why"');
    expect(text).not.toContain('พบ '); // AI rationale strings never leave the teacher side

    const verified = (await review()).body.items.filter((i: any) => i.status === 'VERIFIED');
    const mean = verified.reduce((s: number, i: any) => s + gradeValue(i.grade)!, 0) / verified.length;
    expect(rel.body.snapshot.average).toBeCloseTo(mean, 10);
    expect(rel.body.snapshot.weighting).toBe('equal');

    const subId = (await h.db.query(`select id from submissions where student_id = 'u_nicha'`))[0].id;
    const fb = await h.call('GET', `/v1/submissions/${subId}/feedback`, { as: 'u_nicha' });
    expect(fb.status).toBe(200);
    expect(fb.body).toMatchObject({ status: 'REVISION_REQUIRED', releasedBy: 'ผศ.ดร. กมลชนก วีรกุล', mode: 'revise' });
    const other = await h.call('GET', `/v1/submissions/${subId}/feedback`, { as: 'u_thanawat' });
    expect(other.status).toBe(403);
  });

  it('locks every item after release and keeps the release row immutable', async () => {
    const it0 = await item('1.1');
    const r = await h.call('POST', `/v1/reviews/${sv}/items/1.1/undo`, { as: 'u_teacher', body: { rowVersion: it0.rowVersion } });
    expect(r.body.code).toBe('RELEASED_LOCKED');
    await expect(h.db.query(`update feedback_releases set note = 'x'`)).rejects.toThrow(/append-only/);
    const again = await h.call('POST', `/v1/reviews/${sv}/release`, { as: 'u_teacher', body: { mode: 'finalize' } });
    expect(again.body.code).toBe('ALREADY_RELEASED');
  });

  it('summarises the round from released results and surfaces shared gaps', async () => {
    const s = await h.call('GET', `/v1/courses/${COURSE_ID}/summary`, { as: 'u_teacher' });
    expect(s.body.released).toBe(1);
    expect(s.body.criteria).toHaveLength(4);
    expect(s.body.sharedGaps.map((g: any) => g.no)).toEqual(expect.arrayContaining(['1.3', '2.4', '4.4']));
  });

  it('groups learners for the teacher with evidence and to-dos', async () => {
    const r = await h.call('GET', `/v1/courses/${COURSE_ID}/insights`, { as: 'u_teacher' });
    const all = r.body.groups.flatMap((g: any) => g.students.map((s: any) => [s.student.id, g.key]));
    expect(all).toHaveLength(2);
    expect(Object.fromEntries(all).u_thanawat).toBe('insufficient');
    const nicha = r.body.groups.flatMap((g: any) => g.students).find((s: any) => s.student.id === 'u_nicha');
    expect(nicha.evidence.join(' ')).toContain('ส่งกลับให้แก้');
    expect(Object.fromEntries(all).u_nicha).toBe('needs_feedback');
  });
});

describe('Gate 1 · AI failure paths', () => {
  it('drops a proposal whose anchor does not match the text and logs claim_dropped (AC-03)', async () => {
    const original = h.ai.analyzeSubmission.bind(h.ai);
    h.ai.analyzeSubmission = async (input) => {
      const out = await original(input);
      return out.map((p) => (p.itemNo === '2.1' ? { ...p, anchors: p.anchors.map((a) => ({ ...a, hash: 'deadbeef0000' })) } : p));
    };
    try {
      await h.db.query(`insert into enrollments(course_id, user_id) values ($1, 'u_joe')`, [COURSE_ID]);
      await h.db.query('insert into ai_disclosures(assignment_id, student_id, tool, part, at) values ($1, $2, $3, $4, now())', [ASSIGNMENT_ID, 'u_joe', 'ไม่ได้ใช้', '-']);
      await h.db.query(`insert into precheck_runs(assignment_id, student_id, content_hash, result, at) values ($1, 'u_joe', 'x', '[]', now())`, [ASSIGNMENT_ID]);
      const [joe] = await h.db.query<UserRow>(`select * from users where id = 'u_joe'`);
      const out = await submitVersion(h.deps, { student: joe, assignmentId: ASSIGNMENT_ID, content: '2.1 Intro\nThis study adopts a lens, defining capability as sensing.', cid: 'cid-test03' });
      await h.queue.drain();
      const it21 = await item('2.1', out.versionId);
      expect(it21).toMatchObject({ status: 'NO_PROPOSAL', aiGrade: null, reasonCode: 'claim_dropped', anchors: [] });
      const d = await h.db.query(`select detail from diagnostics where subject_id = $1 and kind = 'claim_dropped'`, [out.versionId]);
      expect(d.length).toBeGreaterThan(0);
      expect(d[0].detail).toContain('AC-03');
    } finally {
      h.ai.analyzeSubmission = original;
    }
  });

  it('when AI stays down, retries then abandons and the teacher reviews without proposals', async () => {
    h.ai.setDown(true);
    try {
      await h.db.query(`insert into enrollments(course_id, user_id) values ($1, 'u_noey')`, [COURSE_ID]);
      await h.db.query('insert into ai_disclosures(assignment_id, student_id, tool, part, at) values ($1, $2, $3, $4, now())', [ASSIGNMENT_ID, 'u_noey', 'ไม่ได้ใช้', '-']);
      await h.db.query(`insert into precheck_runs(assignment_id, student_id, content_hash, result, at) values ($1, 'u_noey', 'x', '[]', now())`, [ASSIGNMENT_ID]);
      const [noey] = await h.db.query<UserRow>(`select * from users where id = 'u_noey'`);
      const out = await submitVersion(h.deps, { student: noey, assignmentId: ASSIGNMENT_ID, content: '2.1 Intro\nA short chapter.', cid: 'cid-test04' });
      expect(out.receipt.id).toMatch(/^RCP-/); // receipt exists even though AI is down (AC-01)
      await h.queue.drain();
      const [run] = await h.db.query('select status, attempts from analysis_runs where submission_version_id = $1', [out.versionId]);
      expect(run).toMatchObject({ status: 'ABANDONED', attempts: 3 });
      const r = await review('u_teacher', out.versionId);
      expect(r.body.items.every((i: any) => i.status === 'NO_PROPOSAL')).toBe(true);
      const g = await decide('1.1', { action: 'grade', grade: 'C', reason: 'ตรวจเองทั้งบท', rowVersion: 1 }, 'u_teacher', out.versionId);
      expect(g.status).toBe(200);
    } finally {
      h.ai.setDown(false);
    }
  });
});

