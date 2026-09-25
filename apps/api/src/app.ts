import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Db, Queryable } from './db/index.js';
import type { Clock } from './core/clock.js';
import type { AiProvider } from './ai/provider.js';
import { JobQueue } from './core/queue.js';
import { verifyToken } from './core/auth.js';
import { correlationId } from './core/ids.js';
import { errorBody, type UserRow } from './core/http.js';
import { registerFoundation } from './modules/foundation.js';
import { registerIdeax } from './modules/ideax/index.js';
import { registerThaitern } from './modules/thaitern.js';
import { registerPartner } from './modules/partner.js';
import { registerMarket } from './modules/market.js';

export interface Deps {
  db: Db;
  clock: Clock;
  ai: AiProvider;
  queue: JobQueue;
  config: { devTools: boolean };
  /** Cross-gate reactions, so earlier gates never import later ones. */
  hooks: Hooks;
}

export interface Hooks {
  consentWithdrawn: Array<(q: Queryable, e: { userId: string; code: string; at: Date; cid: string }) => Promise<void>>;
}

export function createHooks(): Hooks {
  return { consentWithdrawn: [] };
}

export function createQueue(opts?: { backoffMs?: (n: number) => number; maxAttempts?: number }) {
  return new JobQueue({
    maxAttempts: opts?.maxAttempts ?? 3,
    backoffMs: opts?.backoffMs ?? ((n) => 500 * 2 ** (n - 1)),
  });
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  await app.register(cors, { origin: true, exposedHeaders: ['x-correlation-id'] });

  app.decorateRequest('user', null);
  app.decorateRequest('cid', '');

  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-correlation-id'];
    req.cid = typeof incoming === 'string' && /^[\w-]{4,64}$/.test(incoming) ? incoming : correlationId();
    reply.header('x-correlation-id', req.cid);
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const userId = verifyToken(auth.slice(7));
      if (userId) {
        const rows = await deps.db.query<UserRow>('select * from users where id = $1', [userId]);
        req.user = rows[0] ?? null;
      }
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = errorBody(err);
    if (status >= 500) console.error(err);
    void reply.status(status).send(body);
  });

  registerFoundation(app, deps);
  registerIdeax(app, deps);
  registerThaitern(app, deps);
  registerPartner(app, deps);
  registerMarket(app, deps);
  return app;
}
