import type { Deps } from '../app.js';
import { CASES } from './thaitern-data.js';

export const ROUND_ID = 'round_2026_2';

/** Published demo cases. Gate 3 tests run the production pipeline itself; the seed skips to PUBLISHED. */
export async function seedThaitern(deps: Deps) {
  const { db, clock } = deps;
  const now = clock.now();
  await db.query('insert into rounds(id, name, starts_at, ends_at) values ($1, $2, $3, $4)', [
    ROUND_ID,
    'รอบนำร่อง ภาคเรียนที่ 2/2569',
    new Date(now.getTime() - 30 * 86400000),
    new Date(now.getTime() + 120 * 86400000),
  ]);
  for (const c of CASES) {
    await db.query(
      `insert into cases(id, org_id, track, sme_group, sub_category, industry, province, title, teaser, challenge_brief, status, stages,
                         reviewed_by, reviewed_at, review_notes, approved_at, published_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PUBLISHED', $11, 'u_reviewer', $12, 'ตรวจความสมจริงและความชัดเจนแล้ว', $12, $12)`,
      [c.id, c.org, c.track, c.smeGroup, c.subCategory, c.industry, c.province, c.title, c.teaser, c.challengeBrief, c.stages, now],
    );
    await db.query(`insert into data_agreements(id, case_id, org_id, signed_by, signed_at) values ($1, $2, $3, $4, $5)`, [`agr_${c.id}`, c.id, c.org, c.owner, now]);
    await db.query(
      `insert into case_versions(id, case_id, version_no, booklet, data_room, personas, finance, questions, criteria) values ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
      [`cv_${c.id}_1`, c.id, JSON.stringify(c.booklet), JSON.stringify(c.dataRoom), JSON.stringify(c.personas), JSON.stringify(c.finance), JSON.stringify(c.questions), JSON.stringify(c.criteria)],
    );
  }
}
