/** Browser stand-in for the few node:crypto calls the API uses (demo build only). */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

class Bytes extends Uint8Array {
  override toString(enc?: string): string {
    return enc === 'hex' ? bytesToHex(this) : super.toString();
  }
}

export function randomBytes(n: number): Bytes {
  const b = new Bytes(n);
  crypto.getRandomValues(b);
  return b;
}

export function createHash(_alg: 'sha256') {
  let data = '';
  const h = {
    update(s: string) {
      data += s;
      return h;
    },
    digest(_enc: 'hex') {
      return bytesToHex(sha256(utf8ToBytes(data)));
    },
  };
  return h;
}
