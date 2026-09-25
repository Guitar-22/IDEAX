import { randomBytes, createHash } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export function correlationId(): string {
  return `cid-${randomBytes(3).toString('hex')}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Short fingerprint shown to users, e.g. sha256:5e1b8c */
export function fingerprint(text: string): string {
  return `sha256:${sha256(text).slice(0, 6)}`;
}

export function randomDigits(n: number): string {
  let s = '';
  const bytes = randomBytes(n);
  for (let i = 0; i < n; i++) s += String(bytes[i] % 10);
  return s;
}
