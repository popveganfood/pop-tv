// Banco descartável por arquivo de teste + app Fastify em memória (app.inject).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'poptv-'));
process.env.NODE_ENV = 'test';

const { default: pg } = await import('pg');
const db = await import('../src/db.ts');
const { buildApp } = await import('../src/app.ts');
const { hashPassword } = await import('../src/auth.ts');
const { invalidate } = await import('../src/resolver.ts');
const { resetLimits } = await import('../src/ratelimit.ts');

const BASE = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/postgres';

export const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
export const CONSOLACAO = '00000000-0000-4000-8000-0000000c0501';
export const FALLBACK = '00000000-0000-4000-8000-00000000f001';

export async function setup() {
  const name = 'pop_tv_test_' + randomBytes(4).toString('hex');
  const admin = new pg.Client({ connectionString: BASE });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(BASE); url.pathname = '/' + name;
  const pool = db.createPool(url.toString());
  db.setPool(pool);
  await db.migrate(pool);
  invalidate(); resetLimits();
  const app = await buildApp({ logger: false });

  async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({
      method: method as any, url: path, headers: body !== undefined || method !== 'GET' ? { 'content-type': 'application/json', ...headers } : headers,
      payload: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '' : undefined,
    });
    let json: any = null;
    try { json = res.json(); } catch { /* sem corpo */ }
    return { status: res.statusCode, json, cookies: res.cookies as { name: string; value: string }[] };
  }

  async function createUser(email: string, role: string, extra: Record<string, unknown> = {}) {
    const u = await db.one(`insert into users(name, email, password_hash, role, all_units, can_manage_screens, can_publish) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [email, email, await hashPassword('senha-forte-123'), role, !!extra.all_units, !!extra.can_manage_screens, !!extra.can_publish]);
    for (const uid of (extra.unit_ids as string[]) ?? []) await db.q('insert into user_units values ($1,$2)', [u.id, uid]);
    return u.id as string;
  }

  /** devolve um cliente autenticado (cookie de sessão) */
  async function login(email: string) {
    const r = await api('POST', '/api/auth/login', { email, password: 'senha-forte-123' });
    if (r.status !== 200) throw new Error('login falhou: ' + JSON.stringify(r.json));
    const cookie = `pop_session=${r.cookies.find((c) => c.name === 'pop_session')!.value}`;
    return (method: string, path: string, body?: unknown) => api(method, path, body, { cookie });
  }

  /** TV completa: gera código, admin confirma, TV recebe a credencial */
  async function pairTv(as: Awaited<ReturnType<typeof login>>, extra: Record<string, unknown> = {}) {
    const start = await api('POST', '/api/player/pair/start');
    const claim = await as('POST', '/api/pairing/claim', { code: start.json.code, unit_id: CONSOLACAO, name: 'TV', orientation: 'landscape', ...extra });
    if (claim.status !== 200) throw new Error('claim: ' + JSON.stringify(claim.json));
    const poll = await api('POST', '/api/player/pair/poll', { poll_token: start.json.poll_token });
    const token = poll.json.device_token as string;
    const sync = (body: Record<string, unknown> = {}) => api('POST', '/api/player/sync', body, { authorization: `Bearer ${token}` });
    return { id: claim.json.id as string, token, sync };
  }

  /** envia um arquivo pelo fluxo real (URL assinada → PUT → complete) */
  async function upload(as: Awaited<ReturnType<typeof login>>, file: string, mime: string, name = file) {
    const buf = fixture(file);
    const r = await as('POST', '/api/media/uploads', { name, mime, size: buf.length });
    if (r.status !== 200) return r;
    const put = await app.inject({ method: 'PUT', url: r.json.upload.url, headers: { 'content-type': mime }, payload: buf });
    if (put.statusCode !== 200) throw new Error('PUT ' + put.statusCode);
    return as('POST', `/api/media/${r.json.id}/complete`, {});
  }

  async function cleanup() {
    await app.close();
    await pool.end();
    const a = new pg.Client({ connectionString: BASE });
    await a.connect();
    await a.query(`drop database if exists ${name} with (force)`);
    await a.end();
  }

  return { app, api, createUser, login, pairTv, upload, cleanup, q: db.q, one: db.one };
}
