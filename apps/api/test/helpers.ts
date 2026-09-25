import { buildApp, createHooks, createQueue, type Deps } from '../src/app.js';
import { createPgliteDb, migrate } from '../src/db/index.js';
import { FakeClock } from '../src/core/clock.js';
import { MockAiProvider } from '../src/ai/mock.js';
import { signToken } from '../src/core/auth.js';
import { registerJobs } from '../src/jobs.js';
import { seedFoundation } from '../src/seed/foundation.js';

export type Harness = Awaited<ReturnType<typeof makeHarness>>;

/** Fresh in-memory Postgres + app per test file. Queue retries have no delay. */
export async function makeHarness(opts: { seed?: (deps: Deps) => Promise<void> } = {}) {
  const db = await createPgliteDb();
  await migrate(db);
  const clock = new FakeClock();
  const ai = new MockAiProvider();
  const queue = createQueue({ backoffMs: () => 0 });
  const deps: Deps = { db, clock, ai, queue, config: { devTools: true }, hooks: createHooks() };
  registerJobs(deps);
  await seedFoundation(db);
  if (opts.seed) await opts.seed(deps);
  const app = await buildApp(deps);

  async function call<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, o: { as?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const token = o.token ?? (o.as ? signToken(o.as) : undefined);
    const res = await app.inject({
      method,
      url,
      payload: o.body as any,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(o.headers ?? {}) },
    });
    let json: any = null;
    try {
      json = res.json();
    } catch {
      json = res.body;
    }
    return { status: res.statusCode, body: json as T, headers: res.headers, raw: res.body };
  }

  return { app, db, clock, ai, queue, deps, call, close: async () => { await app.close(); await db.close(); } };
}
