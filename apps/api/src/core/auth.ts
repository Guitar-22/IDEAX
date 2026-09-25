import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.AUTH_SECRET ?? 'dev-only-secret-change-me';

/** Opaque bearer token: base64url(userId).hmac */
export function signToken(userId: string): string {
  const body = Buffer.from(userId, 'utf8').toString('base64url');
  const mac = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyToken(token: string): string | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expect = createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return Buffer.from(body, 'base64url').toString('utf8');
}
