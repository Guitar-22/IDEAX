/** Demo build: same token shape as core/auth.ts (base64url(userId).hmac) without Node's Buffer. */
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';

const SECRET = utf8ToBytes('in-browser-demo');

function b64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function signToken(userId: string): string {
  const body = b64url(utf8ToBytes(userId));
  return `${body}.${b64url(hmac(sha256, SECRET, utf8ToBytes(body)))}`;
}

export function verifyToken(token: string): string | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  if (b64url(hmac(sha256, SECRET, utf8ToBytes(body))) !== mac) return null;
  return fromB64url(body);
}
