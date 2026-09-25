import { buildApp, createHooks, createQueue } from './app.js';
import { createDb, migrate } from './db/index.js';
import { systemClock } from './core/clock.js';
import { MockAiProvider } from './ai/mock.js';
import { registerJobs } from './jobs.js';
import { seedAll } from './seed/index.js';

const port = Number(process.env.PORT ?? 4000);
const devTools = process.env.NODE_ENV !== 'production' || process.env.DEV_TOOLS === '1';

const db = await createDb();
const applied = await migrate(db);
const queue = createQueue();
const ai = new MockAiProvider();
const deps = { db, clock: systemClock, ai, queue, config: { devTools }, hooks: createHooks() };
registerJobs(deps);

const [{ count }] = await db.query<{ count: number }>('select count(*)::int as count from users');
if (count === 0 && process.env.SEED !== '0') {
  await seedAll(deps);
  console.log('seeded demo data');
}

const app = await buildApp(deps);
await app.listen({ port, host: '0.0.0.0' });
console.log(`api ready on :${port} · db=${db.kind} · migrations applied=${applied.length} · ai=${ai.model}`);
