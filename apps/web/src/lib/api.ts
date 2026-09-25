'use client';
/** Thin client for the IDEAX API: bearer token, correlation id, uniform errors. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public messageTh: string,
    public details?: any,
  ) {
    super(messageTh);
  }
}

const TOKEN_KEY = 'ideax.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session simply won't persist */
  }
}

function cid() {
  return `cid-${Math.random().toString(16).slice(2, 8)}`;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-correlation-id': cid(),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.code ?? 'ERROR', json?.message_th ?? 'เกิดข้อผิดพลาด', json?.details);
  return json as T;
}

/** Reads a Server-Sent Events response token by token (Stakeholder Chat). */
export async function streamSse(path: string, body: unknown, onToken: (t: string) => void): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-correlation-id': cid() },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => null);
    throw new ApiError(res.status, j?.code ?? 'ERROR', j?.message_th ?? 'เกิดข้อผิดพลาด');
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = block.match(/^event: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (ev === 'token' && data) onToken(JSON.parse(data));
    }
  }
}

export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.messageTh;
  return 'เชื่อมต่อระบบไม่ได้ ลองอีกครั้ง';
}
