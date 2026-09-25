import type { Deps } from '../app.js';
import type { UserRow } from '../core/http.js';
import { submitVersion } from '../modules/ideax/service.js';
import { CHAPTER_V3, DBA_RUBRIC, PRECHECK_ITEMS, THANAWAT_V1 } from './ideax-data.js';

export const COURSE_ID = 'crs_dba801';
export const ASSIGNMENT_ID = 'asg_litreview';

export async function seedIdeaxCatalog(deps: Deps) {
  const { db, clock } = deps;
  const r = DBA_RUBRIC;
  await db.query('insert into rubrics(id, name, pass_mark, weights, source) values ($1, $2, $3, null, $4)', [r.id, r.name, r.passMark, r.source]);
  for (const [i, c] of r.criteria.entries()) {
    await db.query('insert into rubric_criteria(id, rubric_id, no, name, purpose, th, position) values ($1, $2, $3, $4, $5, $6, $7)', [c.id, r.id, c.no, c.name, c.purpose, c.th, i]);
  }
  for (const [i, it] of r.items.entries()) {
    await db.query('insert into rubric_items(id, rubric_id, criterion_id, no, text, hints, position) values ($1, $2, $3, $4, $5, $6, $7)', [
      `${r.id}:${it.no}`,
      r.id,
      it.c,
      it.no,
      it.text,
      JSON.stringify({ ...it.hints, precheck: PRECHECK_ITEMS.includes(it.no) }),
      i,
    ]);
  }
  await db.query(`insert into courses(id, name, code, instructor_id) values ($1, 'Doctoral Research Seminar · Literature Review', 'DBA 801', 'u_teacher')`, [COURSE_ID]);
  for (const s of ['u_nicha', 'u_thanawat']) await db.query(`insert into enrollments(course_id, user_id, role) values ($1, $2, 'student')`, [COURSE_ID, s]);
  await db.query(`insert into enrollments(course_id, user_id, role) values ($1, 'u_marker', 'marker')`, [COURSE_ID]);
  const due = new Date(clock.now().getTime() + 10 * 24 * 3600 * 1000);
  await db.query(
    `insert into assignments(id, course_id, rubric_id, title, brief, due_at, min_words, max_words, requires_disclosure, verification)
     values ($1, $2, $3, 'Literature Review Chapter', $4, $5, 150, 10000, true, true)`,
    [
      ASSIGNMENT_ID,
      COURSE_ID,
      r.id,
      'เขียนบทที่ 2 ทบทวนวรรณกรรมของหัวข้อวิทยานิพนธ์ ตามเกณฑ์ 4 ด้าน 16 ข้อ · ใช้ AI ได้แต่ต้องชี้แจงว่าใช้กับส่วนไหน และตรวจทานอะไรเอง · เดโมนี้ใช้บทตัวอย่างฉบับย่อ จึงตั้งช่วงคำไว้ 150–10,000 คำ',
      due,
    ],
  );
}

/** Submits the demo chapters through the real service, then lets the analysis job run. */
export async function seedIdeaxSubmissions(deps: Deps) {
  const { db, queue } = deps;
  const users = await db.query<UserRow>(`select * from users where id in ('u_nicha', 'u_thanawat')`);
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  for (const [id, content, tool] of [
    ['u_nicha', CHAPTER_V3, 'ผู้ช่วย AI สำหรับขัดเกลาภาษาอังกฤษ'],
    ['u_thanawat', THANAWAT_V1, 'ไม่ได้ใช้'],
  ] as const) {
    // use the app clock, never the database's now(): every time comparison runs on server time
    const at = new Date(deps.clock.now().getTime() - 60_000);
    await db.query('insert into ai_disclosures(assignment_id, student_id, tool, part, at) values ($1, $2, $3, $4, $5)', [ASSIGNMENT_ID, id, tool, 'ใช้ขัดเกลาภาษาใน §2.3 การเลือกงานอ้างอิงและการตีความทำเอง', at]);
    await db.query(`insert into precheck_runs(assignment_id, student_id, content_hash, result, at) values ($1, $2, 'seed', '[]', $3)`, [ASSIGNMENT_ID, id, at]);
    await submitVersion(deps, { student: byId[id], assignmentId: ASSIGNMENT_ID, content, cid: 'cid-seed01' });
  }
  await queue.drain();
}
