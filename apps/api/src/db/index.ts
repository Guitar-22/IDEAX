import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Anything that can run a parameterised query: the pool itself or an open transaction. */
export interface Queryable {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs fn inside BEGIN/COMMIT; any throw rolls back. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  readonly kind: 'pglite' | 'postgres';
}

/** In-process Postgres (WASM). Default for dev and tests: no server needed. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  return {
    kind: 'pglite',
    async query(sql, params = []) {
      const r = await pg.query(sql, params as any[]);
      return r.rows as any[];
    },
    async tx(fn) {
      return pg.transaction(async (t) =>
        fn({ query: async (sql, params = []) => (await t.query(sql, params as any[])).rows as any[] }),
      );
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async close() {
      await pg.close();
    },
  };
}

/** Real PostgreSQL via DATABASE_URL (production / staging). */
export async function createPostgresDb(url: string): Promise<Db> {
  const { default: pgmod } = await import('pg');
  const pool = new pgmod.Pool({ connectionString: url, max: 10 });
  return {
    kind: 'postgres',
    async query(sql, params = []) {
      return (await pool.query(sql, params as any[])).rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: async (sql, params = []) => (await client.query(sql, params as any[])).rows });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

export async function createDb(): Promise<Db> {
  if (process.env.DATABASE_URL) return createPostgresDb(process.env.DATABASE_URL);
  return createPgliteDb(process.env.PGLITE_DIR);
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies migrations/*.sql in name order, once each. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, f), 'utf8');
    await db.exec(sql);
    await db.query('insert into schema_migrations(name) values ($1)', [f]);
    applied.push(f);
  }
  return applied;
}
