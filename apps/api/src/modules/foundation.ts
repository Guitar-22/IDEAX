/** Gate 0 · identity, consent, audit, diagnostics, dev tools */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CONSENTS, SignupBody, type ConsentCode } from '@ideax/contracts';
import type { Deps } from '../app.js';
import { signToken } from '../core/auth.js';
import { AppError, notFound, unprocessable } from '../core/errors.js';
import { actorOf, parse, requireRole, requireUser, type UserRow } from '../core/http.js';
import { newId, randomDigits } from '../core/ids.js';
import { audit, trace } from '../core/audit.js';
import { consentState, isMinor, recordConsent } from './consent.js';

const STAFF = ['thesis_mentor', 'case_ops', 'judge', 'platform_admin'] as const;
const OTP_TTL_MS = 10 * 60 * 1000;

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    orgId: u.org_id,
    institution: u.institution,
    province: u.province,
    faculty: u.faculty,
    birthYear: u.birth_year,
    studentCardVerified: u.student_card_verified,
  };
}

export function registerFoundation(app: FastifyInstance, { db, clock, ai, config, hooks }: Deps) {
  app.get('/v1/health', async () => ({ ok: true, db: db.kind, ai: ai.model, aiDown: ai.isDown() }));
  app.get('/v1/time', async () => ({ now: clock.now().toISOString(), tz: 'Asia/Bangkok' }));

  /* ---------- sign up with consent (plan appendix B) ---------- */
  app.post('/v1/auth/signup', async (req, reply) => {
    const body = parse(SignupBody, req.body);
    const missing = (Object.keys(CONSENTS) as ConsentCode[]).filter(
      (c) => CONSENTS[c].required && !body.consents.includes(c as never),
    );
    if (missing.length) throw unprocessable('CONSENT_REQUIRED', 'ต้องยอมรับข้อกำหนดที่บังคับทั้ง 3 ข้อก่อนสมัคร', { missing });
    const minor = isMinor({ birth_year: body.birthYear }, clock);
    if (minor && !body.guardianPhone) {
      throw unprocessable('GUARDIAN_PHONE_REQUIRED', 'ผู้สมัครอายุต่ำกว่า 20 ปีต้องระบุเบอร์โทรผู้ปกครองเพื่อขอความยินยอม');
    }
    const exists = await db.query('select 1 from users where email = $1', [body.email]);
    if (exists.length) throw new AppError(409, 'EMAIL_TAKEN', 'อีเมลนี้มีบัญชีอยู่แล้ว');

    const id = newId('usr');
    const now = clock.now();
    const otp = minor ? randomDigits(6) : null;
    await db.tx(async (q) => {
      await q.query(
        `insert into users(id, name, email, role, birth_year, institution, province, faculty, phone, guardian_phone, created_at)
         values ($1, $2, $3, 'learner', $4, $5, $6, $7, $8, $9, $10)`,
        [id, body.name, body.email, body.birthYear, body.institution, body.province, body.faculty ?? null, body.phone, body.guardianPhone ?? null, now],
      );
      for (const code of body.consents) await recordConsent(q, id, code, 'given', 'signup_clickwrap', now);
      if (otp) {
        await q.query(`insert into guardian_otps(user_id, phone, code, expires_at) values ($1, $2, $3, $4)`, [
          id,
          body.guardianPhone,
          otp,
          new Date(now.getTime() + OTP_TTL_MS),
        ]);
      }
      const actor = { id, role: 'learner', name: body.name };
      await audit(q, { cid: req.cid, actor, object: `User · ${body.name}`, prev: '-', next: 'REGISTERED', reason: `consents=${body.consents.join(',')}${minor ? ' · guardian_pending' : ''}` });
      await trace(q, { cid: req.cid, actorId: id, type: 'signup.completed', journeyStep: '1', context: { kind: 'user', id }, payload: { minor, province: body.province } });
    });
    const user = (await db.query<UserRow>('select * from users where id = $1', [id]))[0];
    return reply.status(201).send({
      token: signToken(id),
      user: publicUser(user),
      guardianRequired: minor,
      // The OTP travels by SMS (AIS Open API) in production; dev mode returns it so the flow can be demoed.
      ...(config.devTools && otp ? { devOtp: otp } : {}),
    });
  });

  app.post('/v1/consents/guardian/confirm', async (req) => {
    const u = requireUser(req);
    const { code } = parse(z.object({ code: z.string().length(6) }), req.body);
    const rows = await db.query<{ id: string; code: string; expires_at: Date; confirmed_at: Date | null; attempts: number }>(
      `select * from guardian_otps where user_id = $1 and confirmed_at is null order by expires_at desc limit 1`,
      [u.id],
    );
    const otp = rows[0];
    if (!otp) throw notFound('คำขอความยินยอมที่รอยืนยัน');
    if (otp.attempts >= 5) throw unprocessable('OTP_LOCKED', 'กรอกรหัสผิดเกิน 5 ครั้ง กรุณาขอรหัสใหม่');
    if (new Date(otp.expires_at) < clock.now()) throw unprocessable('OTP_EXPIRED', 'รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่');
    if (otp.code !== code) {
      await db.query('update guardian_otps set attempts = attempts + 1 where id = $1', [otp.id]);
      throw unprocessable('OTP_INVALID', 'รหัสไม่ถูกต้อง');
    }
    await db.tx(async (q) => {
      await q.query('update guardian_otps set confirmed_at = $2 where id = $1', [otp.id, clock.now()]);
      await recordConsent(q, u.id, 'guardian', 'given', 'guardian_otp', clock.now());
      await audit(q, { cid: req.cid, actor: { id: u.id, role: 'guardian', name: `ผู้ปกครองของ ${u.name}` }, object: `Consent · guardian · ${u.name}`, prev: 'PENDING_GUARDIAN', next: 'GIVEN', reason: 'otp_verified' });
    });
    return { ok: true, consents: await consentState(db, u.id) };
  });

  app.post('/v1/consents/guardian/resend', async (req) => {
    const u = requireUser(req);
    if (!u.guardian_phone) throw unprocessable('GUARDIAN_PHONE_REQUIRED', 'ยังไม่มีเบอร์ผู้ปกครอง');
    const otp = randomDigits(6);
    await db.query(`insert into guardian_otps(user_id, phone, code, expires_at) values ($1, $2, $3, $4)`, [
      u.id,
      u.guardian_phone,
      otp,
      new Date(clock.now().getTime() + OTP_TTL_MS),
    ]);
    return { ok: true, ...(config.devTools ? { devOtp: otp } : {}) };
  });

  app.get('/v1/me', async (req) => {
    const u = requireUser(req);
    const consents = await consentState(db, u.id);
    const minor = isMinor(u, clock);
    return {
      user: publicUser(u),
      consents,
      minor,
      guardianConfirmed: !minor || consents.guardian,
      serverTime: clock.now().toISOString(),
    };
  });

  app.post('/v1/consents/:code/:action', async (req) => {
    const u = requireUser(req);
    const { code, action } = parse(
      z.object({ code: z.enum(['tos', 'confidentiality', 'pdpa_ai', 'talent_matching']), action: z.enum(['give', 'withdraw']) }),
      req.params,
    );
    const before = await consentState(db, u.id);
    const next = action === 'give';
    if (before[code] === next) return { consents: before };
    await db.tx(async (q) => {
      await recordConsent(q, u.id, code, next ? 'given' : 'withdrawn', 'settings', clock.now());
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Consent · ${code}`, prev: before[code] ? 'GIVEN' : 'NONE', next: next ? 'GIVEN' : 'WITHDRAWN', reason: 'user_choice' });
      if (!next) for (const hook of hooks.consentWithdrawn) await hook(q, { userId: u.id, code, at: clock.now(), cid: req.cid });
    });
    return { consents: await consentState(db, u.id) };
  });

  /** Student ID verification. Production: document review queue; here: accepted on upload. */
  app.post('/v1/identity/student-card', async (req) => {
    const u = requireRole(req, 'learner');
    const { fileName } = parse(z.object({ fileName: z.string().min(1) }), req.body);
    await db.tx(async (q) => {
      await q.query('update users set student_card_verified = true where id = $1', [u.id]);
      await audit(q, { cid: req.cid, actor: actorOf(u), object: `Identity · ${u.name}`, prev: 'UNVERIFIED', next: 'STUDENT_CARD_VERIFIED', reason: `file=${fileName}` });
    });
    return { studentCardVerified: true };
  });

  /* ---------- audit + diagnostics (mockup "บันทึกระบบ") ---------- */
  app.get('/v1/audit', async (req) => {
    const u = requireUser(req);
    const { object, limit } = parse(z.object({ object: z.string().optional(), limit: z.coerce.number().int().max(500).default(100) }), req.query);
    const staff = (STAFF as readonly string[]).includes(u.role);
    const rows = await db.query(
      `select a.*, u.name as actor_name from audit_log a left join users u on u.id = a.actor_id
       where ($1::text is null or a.object ilike '%' || $1 || '%') and ($2 or a.actor_id = $3)
       order by a.id desc limit $4`,
      [object ?? null, staff, u.id, limit],
    );
    return { rows };
  });

  app.get('/v1/diagnostics', async (req) => {
    requireRole(req, ...STAFF);
    const rows = await db.query('select * from diagnostics order by id desc limit 200');
    return { rows };
  });

  app.get('/v1/trace', async (req) => {
    const u = requireUser(req);
    const { contextId } = parse(z.object({ contextId: z.string() }), req.query);
    const staff = (STAFF as readonly string[]).includes(u.role);
    const rows = await db.query(
      `select * from trace_events where context_id = $1 and ($2 or actor_id = $3) order by id`,
      [contextId, staff, u.id],
    );
    return { rows };
  });

  /* ---------- dev tools (never enabled in production) ---------- */
  if (config.devTools) {
    app.get('/v1/dev/personas', async () => {
      const rows = await db.query<UserRow & { org_name: string | null }>(
        `select u.*, o.name as org_name from users u left join organizations o on o.id = u.org_id where u.email like '%@demo.ideax' order by u.created_at, u.id`,
      );
      return { personas: rows.map((r) => ({ ...publicUser(r), orgName: r.org_name })) };
    });
    app.post('/v1/dev/login', async (req) => {
      const { userId } = parse(z.object({ userId: z.string() }), req.body);
      const rows = await db.query<UserRow>('select * from users where id = $1', [userId]);
      if (!rows[0]) throw notFound('ผู้ใช้');
      return { token: signToken(userId), user: publicUser(rows[0]) };
    });
    app.post('/v1/dev/ai-down', async (req) => {
      const { down } = parse(z.object({ down: z.boolean() }), req.body);
      ai.setDown(down);
      return { aiDown: ai.isDown() };
    });
  }
}
