import type { Queryable } from '../db/index.js';
import { CONSENT_TEXT_VERSION } from '@ideax/contracts';

/**
 * Demo organisations and personas. Names come from the mockup and the plan's personas
 * (โจ / เนย / พีท, chapter 3 table 10). All businesses and people here are fictional.
 */
export const ORGS = [
  { id: 'org_ideax', name: 'IDEAX Platform', kind: 'platform', verified: true },
  { id: 'org_uni', name: 'คณะบริหารธุรกิจ (มหาวิทยาลัยตัวอย่าง)', kind: 'university', verified: true },
  { id: 'org_yogurt', name: 'ร้านโยเกิร์ตปั่น “นมเย็นดี” (ตัวอย่างสมมติ)', kind: 'sme', verified: true },
  { id: 'org_hostel', name: 'โฮสเทล “บ้านริมคลอง” (ตัวอย่างสมมติ)', kind: 'sme', verified: true },
  { id: 'org_community', name: 'กลุ่มขนมไทยชุมชนตลาดเก่า (ตัวอย่างสมมติ)', kind: 'community', verified: true },
  { id: 'org_lanmelet', name: 'กลุ่มธุรกิจ ลานเมล็ด (ตัวอย่างสมมติ)', kind: 'company', verified: true },
] as const;

export const USERS = [
  { id: 'u_teacher', name: 'ผศ.ดร. กมลชนก วีรกุล', role: 'thesis_mentor', org: 'org_uni', by: 1980 },
  { id: 'u_marker', name: 'อ.ดร. ธนกฤต แสงมณี', role: 'assistant_marker', org: 'org_uni', by: 1986 },
  { id: 'u_nicha', name: 'ณิชา ตันติเวชกุล', role: 'learner', org: null, by: 1992, inst: 'หลักสูตร DBA (มหาวิทยาลัยตัวอย่าง)', prov: 'เชียงใหม่', card: true, talent: true },
  { id: 'u_thanawat', name: 'ธนวัฒน์ อินทรโชติ', role: 'learner', org: null, by: 1995, inst: 'หลักสูตร DBA (มหาวิทยาลัยตัวอย่าง)', prov: 'ขอนแก่น', card: true },
  { id: 'u_joe', name: 'โจ (ปี 2 บริหารธุรกิจ)', role: 'learner', org: null, by: 2006, inst: 'มหาวิทยาลัยในภาคอีสาน (ตัวอย่าง)', prov: 'ขอนแก่น', card: true, talent: true },
  { id: 'u_noey', name: 'เนย (ม.5)', role: 'learner', org: null, by: 2009, inst: 'โรงเรียนประจำจังหวัดภาคเหนือ (ตัวอย่าง)', prov: 'เชียงราย', card: false, minor: true },
  { id: 'u_owner', name: 'คุณสุดา (เจ้าของร้านนมเย็นดี)', role: 'case_owner', org: 'org_yogurt', by: 1978 },
  { id: 'u_owner2', name: 'คุณเอก (เจ้าของโฮสเทล)', role: 'case_owner', org: 'org_hostel', by: 1983 },
  { id: 'u_reviewer', name: 'ดร. วรเมธ (ผู้เชี่ยวชาญตรวจเคส)', role: 'case_reviewer', org: 'org_ideax', by: 1975 },
  { id: 'u_ops', name: 'ทีมผลิตเคส IDEAX', role: 'case_ops', org: 'org_ideax', by: 1990 },
  { id: 'u_judge', name: 'กรรมการ (Senior Associate)', role: 'judge', org: 'org_ideax', by: 1988 },
  { id: 'u_org', name: 'กลุ่มธุรกิจ ลานเมล็ด', role: 'org_member', org: 'org_lanmelet', by: 1985 },
  { id: 'u_admin', name: 'ผู้ดูแลระบบ', role: 'platform_admin', org: 'org_ideax', by: 1990 },
] as const;

export async function seedFoundation(q: Queryable) {
  for (const o of ORGS) {
    await q.query('insert into organizations(id, name, kind, domain_verified) values ($1, $2, $3, $4) on conflict do nothing', [o.id, o.name, o.kind, o.verified]);
  }
  let i = 0;
  for (const u of USERS) {
    const x = u as any;
    await q.query(
      `insert into users(id, name, email, role, org_id, birth_year, institution, province, phone, guardian_phone, student_card_verified, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now() + ($12 || ' milliseconds')::interval) on conflict do nothing`,
      [u.id, u.name, `${u.id.slice(2)}@demo.ideax`, u.role, u.org, u.by, x.inst ?? null, x.prov ?? null, '0800000000', x.minor ? '0811111111' : null, x.card ?? false, String(i++)],
    );
    const codes = ['tos', 'confidentiality', 'pdpa_ai', ...(x.talent ? ['talent_matching'] : [])];
    for (const c of codes) {
      await q.query(`insert into consent_records(user_id, code, text_version, action, channel) values ($1, $2, $3, 'given', 'seed')`, [u.id, c, CONSENT_TEXT_VERSION]);
    }
  }
}
