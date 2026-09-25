import { CONSENT_TEXT_VERSION, GUARDIAN_AGE_LIMIT, type ConsentCode } from '@ideax/contracts';
import type { Queryable } from '../db/index.js';
import type { Clock } from '../core/clock.js';
import { unprocessable } from '../core/errors.js';
import type { UserRow } from '../core/http.js';

export type ConsentState = Record<ConsentCode, boolean>;

export async function consentState(q: Queryable, userId: string): Promise<ConsentState> {
  const rows = await q.query<{ code: ConsentCode; action: string }>(
    `select distinct on (code) code, action from consent_records where user_id = $1 order by code, seq desc`,
    [userId],
  );
  const state: ConsentState = { tos: false, confidentiality: false, pdpa_ai: false, talent_matching: false, guardian: false };
  for (const r of rows) state[r.code] = r.action === 'given';
  return state;
}

export async function recordConsent(
  q: Queryable,
  userId: string,
  code: ConsentCode,
  action: 'given' | 'withdrawn',
  channel: string,
  at: Date,
) {
  await q.query(
    `insert into consent_records(user_id, code, text_version, action, channel, at) values ($1, $2, $3, $4, $5, $6)`,
    [userId, code, CONSENT_TEXT_VERSION, action, channel, at],
  );
}

export function isMinor(user: Pick<UserRow, 'birth_year'>, clock: Clock): boolean {
  if (!user.birth_year) return false;
  return clock.now().getUTCFullYear() - user.birth_year < GUARDIAN_AGE_LIMIT;
}

/**
 * Guard for anything that touches confidential case data or builds credentials:
 * mandatory consents given, and guardian consent for minors (TX-12).
 */
export async function assertLearningConsents(q: Queryable, user: UserRow, clock: Clock) {
  const s = await consentState(q, user.id);
  const missing = (['tos', 'confidentiality', 'pdpa_ai'] as const).filter((c) => !s[c]);
  if (missing.length) throw unprocessable('CONSENT_REQUIRED', 'ต้องยอมรับข้อกำหนดที่บังคับก่อน', { missing });
  if (isMinor(user, clock) && !s.guardian) {
    throw unprocessable('GUARDIAN_CONSENT_REQUIRED', 'ผู้เรียนอายุต่ำกว่า 20 ปีต้องได้รับความยินยอมจากผู้ปกครองก่อน');
  }
}
