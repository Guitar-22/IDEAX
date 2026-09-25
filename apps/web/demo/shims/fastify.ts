/**
 * Minimal in-browser stand-in for Fastify, enough to run apps/api's route modules unchanged
 * inside the demo page. Supports: get/post/put/delete with :params, onRequest hooks,
 * decorateRequest, setErrorHandler, reply.status/header/send/hijack/raw.
 */
type Handler = (req: any, reply: any) => unknown;
interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export interface InjectResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

class Reply {
  statusCode = 200;
  headers: Record<string, string> = { 'content-type': 'application/json' };
  sent = false;
  payload: unknown = undefined;
  hijacked = false;
  chunks: string[] = [];
  raw = {
    writeHead: (code: number, h: Record<string, string>) => {
      this.statusCode = code;
      Object.assign(this.headers, h);
    },
    write: (c: string) => {
      this.chunks.push(c);
    },
    end: () => {},
  };
  status(c: number) {
    this.statusCode = c;
    return this;
  }
  code(c: number) {
    return this.status(c);
  }
  header(k: string, v: string) {
    this.headers[k.toLowerCase()] = v;
    return this;
  }
  getHeaders() {
    return this.headers;
  }
  send(p?: unknown) {
    this.payload = p;
    this.sent = true;
    return this;
  }
  hijack() {
    this.hijacked = true;
  }
}

class FakeFastify {
  private routes: Route[] = [];
  private hooks: Handler[] = [];
  private onError: ((e: unknown, req: any, reply: Reply) => unknown) | null = null;

  decorateRequest() {}
  async register() {}
  addHook(name: string, fn: Handler) {
    if (name === 'onRequest') this.hooks.push(fn);
  }
  setErrorHandler(fn: (e: unknown, req: any, reply: Reply) => unknown) {
    this.onError = fn;
  }
  private add(method: string, path: string, handler: Handler) {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler });
  }
  get(p: string, h: Handler) {
    this.add('GET', p, h);
  }
  post(p: string, h: Handler) {
    this.add('POST', p, h);
  }
  put(p: string, h: Handler) {
    this.add('PUT', p, h);
  }
  delete(p: string, h: Handler) {
    this.add('DELETE', p, h);
  }
  async close() {}

  private match(method: string, path: string) {
    const segs = path.split('/').filter(Boolean).map(decodeURIComponent);
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      r.parts.forEach((p, i) => {
        if (p.startsWith(':')) params[p.slice(1)] = segs[i];
        else if (p !== segs[i]) ok = false;
      });
      if (ok) return { route: r, params };
    }
    return null;
  }

  async inject(opts: { method: string; url: string; headers?: Record<string, string>; body?: string }): Promise<InjectResult> {
    const u = new URL(opts.url, 'http://demo.local');
    const headers = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const req: any = {
      method: opts.method,
      url: opts.url,
      headers,
      query: Object.fromEntries(u.searchParams),
      params: {},
      body: opts.body ? JSON.parse(opts.body) : undefined,
      user: null,
      cid: '',
    };
    const reply = new Reply();
    const finish = (value: unknown): InjectResult => {
      if (reply.hijacked) return { status: reply.statusCode, body: reply.chunks.join(''), headers: reply.headers };
      const p = reply.sent ? reply.payload : value;
      return { status: reply.statusCode, body: p === undefined ? '' : JSON.stringify(p), headers: reply.headers };
    };
    try {
      for (const h of this.hooks) await h(req, reply);
      const m = this.match(req.method, u.pathname);
      if (!m) return { status: 404, body: JSON.stringify({ code: 'NOT_FOUND', message_th: 'ไม่พบหน้าที่เรียก' }), headers: reply.headers };
      req.params = m.params;
      const out = await m.route.handler(req, reply);
      return finish(out instanceof Reply ? undefined : out);
    } catch (e) {
      if (this.onError) await this.onError(e, req, reply);
      return finish(undefined);
    }
  }
}

export type FastifyInstance = FakeFastify;
export default function Fastify(_opts?: unknown) {
  return new FakeFastify();
}
