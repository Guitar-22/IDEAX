import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { Role } from '@ideax/contracts';
import { AppError, forbidden } from './errors.js';
import type { Actor } from './audit.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string | null;
  birth_year: number | null;
  institution: string | null;
  province: string | null;
  faculty: string | null;
  phone: string | null;
  guardian_phone: string | null;
  student_card_verified: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    cid: string;
  }
}

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value);
}

export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): UserRow {
  const u = requireUser(req);
  if (!roles.includes(u.role)) throw forbidden();
  return u;
}

export function actorOf(u: UserRow): Actor {
  return { id: u.id, role: u.role, name: u.name };
}

export function errorBody(err: unknown): { status: number; body: { code: string; message_th: string; details?: unknown } } {
  if (err instanceof AppError) return { status: err.status, body: { code: err.code, message_th: err.messageTh, details: err.details } };
  if (err instanceof ZodError) {
    return { status: 400, body: { code: 'VALIDATION', message_th: 'ข้อมูลที่ส่งมาไม่ครบหรือไม่ถูกต้อง', details: err.issues } };
  }
  const e = err as { statusCode?: number; code?: string };
  if (e?.statusCode && e.statusCode < 500) {
    return { status: e.statusCode, body: { code: e.code ?? 'BAD_REQUEST', message_th: 'คำขอไม่ถูกต้อง' } };
  }
  return { status: 500, body: { code: 'INTERNAL', message_th: 'ระบบขัดข้องชั่วคราว ข้อมูลของคุณยังไม่ถูกเปลี่ยน ลองอีกครั้ง' } };
}

export function sendError(reply: FastifyReply, err: unknown) {
  const { status, body } = errorBody(err);
  return reply.status(status).send(body);
}
