import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';

// datas sem fuso (start_at/end_at) e horários voltam como texto, sem conversão pelo fuso do servidor
pg.types.setTypeParser(1114, (v) => v);
pg.types.setTypeParser(1083, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v)); // bigint → number (tamanhos de arquivo)

export type Db = pg.Pool | pg.PoolClient;

export function createPool(url = config.databaseUrl) {
  return new pg.Pool({
    connectionString: url,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
}

export let pool = createPool();
export function setPool(p: pg.Pool) { pool = p; }

export async function q<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}
export async function one<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  return (await db.query(sql, params)).rows[0] as T | undefined;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(db: pg.Pool = pool) {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query('select name from schema_migrations')).rows.map((r) => r.name));
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query(readFileSync(migrationsDir + file, 'utf8'));
      await c.query('insert into schema_migrations(name) values ($1)', [file]);
      await c.query('commit');
      console.log(`[migração] aplicada ${file}`);
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'migrate') {
  migrate().then(() => pool.end());
}
