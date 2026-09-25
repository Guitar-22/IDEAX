/**
 * The real apps/api running inside the browser: same route modules, same state machines,
 * same seed, on PGlite (Postgres compiled to WebAssembly). Data lives in memory: reload = fresh demo.
 */
import { PGlite } from '@electric-sql/pglite';
import { buildApp, createHooks, createQueue, type Deps } from '../../api/src/app';
import { systemClock } from '../../api/src/core/clock';
import { MockAiProvider } from '../../api/src/ai/mock';
import { registerJobs } from '../../api/src/jobs';
import { seedAll } from '../../api/src/seed/index';
import type { Db } from '../../api/src/db/index';
import m1 from '../../api/src/db/migrations/001_foundation.sql';
import m2 from '../../api/src/db/migrations/002_ideax.sql';
import m3 from '../../api/src/db/migrations/003_thaitern.sql';
import m4 from '../../api/src/db/migrations/004_market.sql';
import type { InjectResult } from './shims/fastify';

export type LocalHandler = (req: { method: string; url: string; headers: Record<string, string>; body?: string }) => Promise<InjectResult>;

async function wasm(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`โหลด ${path} ไม่ได้ (${res.status})`);
  return WebAssembly.compile(await res.arrayBuffer());
}

function assertWasmAllowed() {
  try {
    // smallest valid module: compiling it throws when the page's CSP blocks WebAssembly
    new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  } catch (e) {
    throw new Error(`หน้านี้ไม่อนุญาตให้รัน WebAssembly (${e instanceof Error ? e.message : e})`);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error(`${what} ใช้เวลานานเกิน ${ms / 1000} วินาที`)), ms))]);
}

export async function startBackend(step: (msg: string) => void): Promise<LocalHandler> {
  if (typeof WebAssembly === 'undefined') throw new Error('เบราว์เซอร์นี้ไม่รองรับ WebAssembly');
  assertWasmAllowed();
  return withTimeout(boot(step), 90_000, 'การเปิดฐานข้อมูล');
}

async function boot(step: (msg: string) => void): Promise<LocalHandler> {
  step('กำลังโหลดฐานข้อมูล PostgreSQL (WebAssembly)');
  const [pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
    wasm('pglite.wasm'),
    wasm('initdb.wasm'),
    fetch('pglite-data.wasm').then((r) => {
      if (!r.ok) throw new Error(`โหลด pglite-data.wasm ไม่ได้ (${r.status})`);
      return r.blob();
    }),
  ]);
  const pg = new PGlite({ pgliteWasmModule, initdbWasmModule, fsBundle });
  await pg.waitReady;
  const db: Db = {
    kind: 'pglite',
    async query(sql, params = []) {
      return (await pg.query(sql, params as any[])).rows as any[];
    },
    async tx(fn) {
      return pg.transaction(async (t) => fn({ query: async (sql, params = []) => (await t.query(sql, params as any[])).rows as any[] }));
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async close() {
      await pg.close();
    },
  };
  step('กำลังสร้างตารางและข้อมูลเดโม');
  for (const sql of [m1, m2, m3, m4]) await db.exec(sql);
  const deps: Deps = { db, clock: systemClock, ai: new MockAiProvider(), queue: createQueue({ backoffMs: () => 300 }), config: { devTools: true }, hooks: createHooks() };
  registerJobs(deps);
  step('AI กำลังเตรียมหลักฐานให้งานที่ส่งไว้');
  await seedAll(deps);
  const app = (await buildApp(deps)) as any;
  (globalThis as any).__IDEAX_AI__ = deps.ai;
  return (req) => app.inject(req);
}
