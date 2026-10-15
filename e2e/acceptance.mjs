// Teste de aceitação ponta a ponta: servidor real + Postgres + 2 "TVs" (Chromium) + painel.
// Uso: npm run e2e   (requer Postgres em TEST_DATABASE_URL ou postgres://postgres@localhost:5432/postgres)
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright-core';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const ADMIN_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/postgres';
const DB = 'pop_tv_e2e';
const OUT = new URL('./out/', import.meta.url).pathname;
const STORE = mkdtempSync(join(tmpdir(), 'poptv-e2e-'));
const fx = (n) => readFileSync(new URL(`../server/test/fixtures/${n}`, import.meta.url));
mkdirSync(OUT, { recursive: true });

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`✔ ${name}`); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`✘ ${name}\n   ${e.message}`); }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
async function until(fn, ms = 30000, msg = 'tempo esgotado') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(300); }
  throw new Error(`${msg} (último: ${JSON.stringify(last)})`);
}

// ---------- servidor ----------
const a = new pg.Client({ connectionString: ADMIN_DB });
await a.connect();
await a.query(`drop database if exists ${DB} with (force)`);
await a.query(`create database ${DB}`);
await a.end();
const dbUrl = new URL(ADMIN_DB); dbUrl.pathname = '/' + DB;
let server;
function startServer() {
  server = spawn(process.execPath, ['server/src/index.ts'], {
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DATABASE_URL: dbUrl.toString(), STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: STORE, POLL_SECONDS: '3', ADMIN_EMAIL: 'admin@pop.test', ADMIN_PASSWORD: 'senha-forte-123', PUBLIC_URL: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.env.DEBUG && process.stderr.write(d));
  return until(() => fetch(BASE + '/api/health').then((r) => r.ok), 15000, 'servidor não subiu');
}
await startServer();

let cookie = '';
async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body) });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.includes('pop_session=')) cookie = sc.split(';')[0];
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}
async function upload(file, mime, name) {
  const buf = fx(file);
  const r = await api('POST', '/api/media/uploads', { name, mime, size: buf.length });
  const put = await fetch(BASE + r.upload.url, { method: 'PUT', headers: { 'content-type': mime }, body: buf });
  assert(put.ok, 'PUT falhou');
  return api('POST', `/api/media/${r.id}/complete`, {});
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const tvA = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const tvB = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const shot = (p, n) => p.screenshot({ path: OUT + n + '.png' });
const status = (p) => p.evaluate(() => window.__popTv && { ...window.__popTv.status, items: (window.__popTv.current() || {}).items?.map((i) => i.name) || null });
const visible = (p) => p.evaluate(() => {
  const on = document.querySelector('.layer.on');
  const el = on && on.firstElementChild;
  return el ? { tag: el.tagName, src: el.currentSrc || el.src } : null;
});

let screenA, screenB, img1, img2, vid;

await check('19 · servidor e painel respondem no navegador desktop', async () => {
  await api('POST', '/api/auth/login', { email: 'admin@pop.test', password: 'senha-forte-123' });
  const r = await fetch(BASE + '/');
  assert(r.ok && (await r.text()).includes('POP TV'), 'painel não respondeu');
  assert((await api('GET', '/api/auth/me')).user.role === 'admin', 'login');
});

await check('1–2 · cria unidade e ambientes', async () => {
  const u = await api('POST', '/api/units', { name: 'Unidade E2E', city: 'São Paulo', state: 'SP', timezone: 'America/Sao_Paulo' });
  await api('POST', `/api/units/${u.id}/environments`, { name: 'Salão' });
  await api('POST', `/api/units/${u.id}/environments`, { name: 'Entrada' });
  const envs = await api('GET', `/api/units/${u.id}/environments`);
  assert(envs.length === 2, 'ambientes');
  globalThis.unit = u; globalThis.envs = envs;
});

await check('3 · duas TVs mostram código e são pareadas', async () => {
  await tvA.goto(BASE + '/tv/'); await tvB.goto(BASE + '/tv/');
  const code = (p) => until(() => p.$eval('#code', (e) => e.textContent.replace(/[^A-Z0-9]/g, '')).then((c) => c.length === 6 && c), 15000, 'código não apareceu');
  const cA = await code(tvA), cB = await code(tvB);
  await shot(tvA, '01-pareamento');
  screenA = (await api('POST', '/api/pairing/claim', { code: cA, unit_id: unit.id, environment_id: envs[0].id, name: 'TV Salão', orientation: 'landscape' })).id;
  screenB = (await api('POST', '/api/pairing/claim', { code: cB, unit_id: unit.id, environment_id: envs[1].id, name: 'TV Entrada', orientation: 'landscape' })).id;
  await until(async () => (await status(tvA))?.state !== 'pairing', 15000, 'TV A não saiu do pareamento');
  await until(async () => (await api('GET', `/api/screens/${screenA}`)).online, 15000, 'TV A não ficou online');
  await until(async () => (await api('GET', `/api/screens/${screenB}`)).online, 15000, 'TV B não ficou online');
  await shot(tvA, '02-aguardando');
});

await check('4 · envia imagens e vídeo reais', async () => {
  img1 = (await upload('img.png', 'image/png', 'Promo Burger')).id;
  img2 = (await upload('img.jpg', 'image/jpeg', 'Almoço POP')).id;
  const h264 = await upload('video3s.mp4', 'video/mp4', 'Vídeo H.264');
  assert(h264.codec === 'avc1' && h264.compat === 'ok', 'H.264 deveria ser compatível');
  // O Chromium do Playwright não decodifica H.264 (codec proprietário); para testar a reprodução
  // usamos VP9 dentro de MP4 (aceito com aviso). H.264 é validado nas TVs reais (docs/checklist-tv.md).
  const v = await upload('video3s-vp9.mp4', 'video/mp4', 'Vídeo institucional');
  assert(v.compat === 'warning', 'VP9 deveria gerar aviso');
  vid = v.id;
});

let pl;
await check('5–6 · monta playlist e simula antes de publicar', async () => {
  pl = await api('POST', '/api/playlists', { name: 'Burger da noite' });
  await api('PUT', `/api/playlists/${pl.id}/items`, { items: [{ media_id: img1, duration_ms: 2000 }, { media_id: vid }, { media_id: img2, duration_ms: 2000 }] });
  const d = await api('GET', `/api/playlists/${pl.id}`);
  assert(d.items.length === 3 && d.items.every((i) => i.url), 'rascunho com URLs para pré-visualização');
  assert(d.has_unpublished_changes, 'deveria indicar rascunho não publicado');
  await api('POST', `/api/playlists/${pl.id}/publish`, {});
});

await check('7 · publica somente na TV do salão', async () => {
  await api('POST', '/api/schedules', { name: 'Burger no salão', playlist_id: pl.id, target_type: 'screen', target_id: screenA, priority: 10 });
  await until(async () => (await status(tvA))?.items?.length === 3, 20000, 'TV A não recebeu');
  await until(async () => (await visible(tvA))?.tag, 10000, 'nada visível');
  await shot(tvA, '03-tv-salao-tocando');
  const sB = await status(tvB);
  assert(!sB.items || sB.items.length === 0, 'TV B não deveria receber');
  await until(async () => (await api('GET', `/api/screens/${screenA}`)).in_sync, 15000, 'TV A não confirmou recebimento');
});

await check('10–11 · sequência toca em loop (imagem → vídeo → imagem → volta)', async () => {
  const seen = [];
  const end = Date.now() + 16000;
  while (Date.now() < end) {
    const s = await status(tvA);
    if (s.item && seen[seen.length - 1] !== s.item) seen.push(s.item);
    await sleep(200);
  }
  const txt = seen.join(' → ');
  assert(seen.includes('Vídeo institucional') && seen.includes('Almoço POP'), 'não passou por todos: ' + txt);
  assert(seen.filter((x) => x === 'Promo Burger').length >= 2, 'não voltou ao início: ' + txt);
  console.log('   sequência:', txt);
});

await check('8 · publica num grupo de telas (TV da entrada)', async () => {
  const g = await api('POST', '/api/groups', { name: 'Entradas', unit_id: unit.id });
  await api('PUT', `/api/groups/${g.id}/members`, { screen_ids: [screenB] });
  const p2 = await api('POST', '/api/playlists', { name: 'Almoço' });
  await api('PUT', `/api/playlists/${p2.id}/items`, { items: [{ media_id: img2, duration_ms: 3000 }] });
  await api('POST', `/api/playlists/${p2.id}/publish`, {});
  await api('POST', '/api/schedules', { name: 'Almoço na entrada', playlist_id: p2.id, target_type: 'group', target_id: g.id, priority: 10 });
  await until(async () => (await status(tvB))?.items?.[0] === 'Almoço POP', 20000, 'TV B não recebeu o grupo');
  await shot(tvB, '04-tv-entrada-grupo');
});

let emergencyId;
await check('9 · publica em todas as unidades (emergência com validade) e volta depois', async () => {
  const p3 = await api('POST', '/api/playlists', { name: 'Aviso geral' });
  await api('PUT', `/api/playlists/${p3.id}/items`, { items: [{ media_id: vid }] });
  await api('POST', `/api/playlists/${p3.id}/publish`, {});
  const r = await api('POST', '/api/schedules', { name: 'Aviso urgente', playlist_id: p3.id, target_type: 'all', priority: 100, end_at: '2099-01-01 00:00' });
  emergencyId = r.id;
  await until(async () => (await status(tvA))?.items?.join() === 'Vídeo institucional' && (await status(tvB))?.items?.join() === 'Vídeo institucional', 20000, 'emergência não chegou nas duas');
  await api('DELETE', `/api/schedules/${emergencyId}`);
  await until(async () => (await status(tvA))?.items?.length === 3 && (await status(tvB))?.items?.[0] === 'Almoço POP', 20000, 'não voltou à programação anterior');
});

await check('14 · arquivo que falha na TV não trava a sequência', async () => {
  const bad = await upload('video3s-vp9.mp4', 'video/mp4', 'Vídeo corrompido');
  // corrompe o arquivo já validado, simulando um arquivo que a TV não consegue decodificar
  const dir = join(STORE, 'media', bad.id);
  const file = readdirSync(dir).find((f) => f.endsWith('.mp4'));
  const buf = readFileSync(join(dir, file));
  writeFileSync(join(dir, file), Buffer.concat([buf.subarray(0, 64), Buffer.alloc(buf.length - 64, 7)]));
  const p4 = await api('POST', '/api/playlists', { name: 'Com arquivo ruim' });
  await api('PUT', `/api/playlists/${p4.id}/items`, { items: [{ media_id: img1, duration_ms: 1500 }, { media_id: bad.id }, { media_id: img2, duration_ms: 1500 }] });
  await api('POST', `/api/playlists/${p4.id}/publish`, {});
  const rule = await api('POST', '/api/schedules', { name: 'Teste arquivo ruim', playlist_id: p4.id, target_type: 'screen', target_id: screenB, priority: 50 });
  const seen = new Set();
  await until(async () => { const s = await status(tvB); if (s.item) seen.add(s.item); return seen.has('Promo Burger') && seen.has('Almoço POP') && [...seen].length >= 2 && (await api('GET', `/api/screens/${screenB}`)).last_error; }, 40000, 'sequência travou ou erro não reportado');
  const sc = await api('GET', `/api/screens/${screenB}`);
  assert(/Vídeo corrompido/.test(sc.last_error), 'erro deveria citar o arquivo: ' + sc.last_error);
  await api('DELETE', `/api/schedules/${rule.id}`);
});

await check('13 · sem internet a TV continua tocando (inclusive após recarregar, com cache)', async () => {
  await until(async () => tvA.evaluate(() => !!navigator.serviceWorker.controller), 15000, 'service worker não assumiu');
  await sleep(4000); // tempo para guardar as mídias no cache
  const caps = await tvA.evaluate(() => window.__popTv.caps);
  server.kill('SIGTERM');
  await sleep(1500);
  try {
  const seen = new Set();
  for (let i = 0; i < 30; i++) { const s = await status(tvA); if (s.item) seen.add(s.item); await sleep(300); }
  assert(seen.size >= 2, 'parou de tocar sem servidor: ' + [...seen]);
  await tvA.reload();
  const seen2 = new Set();
  await until(async () => { const s = await status(tvA); if (s?.item) seen2.add(s.item); return seen2.size >= 2; }, 20000, 'após recarregar offline não voltou a tocar');
  const v = await visible(tvA);
  await shot(tvA, '05-offline-apos-recarregar');
  console.log(`   cache offline: ${caps.offlineCache ? 'sim' : 'não'}; tocando de: ${v?.src}`);
  } finally { await startServer(); }
  await until(async () => { const s = await api('GET', `/api/screens/${screenA}`).catch(() => null); return s?.online && s.in_sync; }, 20000, 'não voltou online');
});

await check('12 · TV desconectada aparece offline após a tolerância', async () => {
  await api('PATCH', '/api/org', { offline_after_seconds: 30 });
  await tvB.close();
  await until(async () => !(await api('GET', `/api/screens/${screenB}`)).online, 45000, 'TV B continua online');
});

await check('18 · TV revogada volta ao pareamento e perde acesso', async () => {
  await api('POST', `/api/screens/${screenA}/revoke`, {});
  await until(async () => (await status(tvA))?.state === 'pairing', 20000, 'TV A não voltou ao pareamento');
  await shot(tvA, '06-revogada');
});

await check('16 · restaurar versão anterior', async () => {
  await api('PUT', `/api/playlists/${pl.id}/items`, { items: [{ media_id: img2 }] });
  await api('POST', `/api/playlists/${pl.id}/publish`, {});
  const vs = await api('GET', `/api/playlists/${pl.id}/versions`);
  const v1 = vs.find((v) => v.version === 1);
  const r = await api('POST', `/api/playlists/${pl.id}/versions/${v1.id}/restore`, {});
  assert(r.version === 3, 'nova versão');
  assert((await api('GET', `/api/playlists/${pl.id}`)).items.length === 3, 'rascunho restaurado');
});

// ---------- painel (interface) ----------
await check('Painel · login e dashboard com dados reais', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE + '/');
  await p.fill('input[type=email]', 'admin@pop.test');
  await p.fill('input[type=password]', 'senha-forte-123');
  await p.click('button[type=submit]');
  await p.waitForSelector('text=Sala de controle', { timeout: 10000 });
  await sleep(800);
  await shot(p, '10-painel-dashboard');
  for (const [path, name] of [['/telas', '11-painel-telas'], ['/midia', '12-painel-midia'], ['/playlists', '13-painel-playlists'], ['/programacao', '14-painel-programacao'], ['/unidades', '15-painel-unidades'], ['/usuarios', '16-painel-usuarios']]) {
    await p.goto(BASE + path);
    await sleep(1200);
    await shot(p, name);
  }
  await p.goto(BASE + `/playlists/${pl.id}`);
  await sleep(1200);
  await shot(p, '17-painel-editor-playlist');
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage();
  await m.context().addCookies([{ name: 'pop_session', value: cookie.split('=')[1], url: BASE }]);
  await m.goto(BASE + '/');
  await sleep(1500);
  await shot(m, '18-painel-celular');
  assert(errors.length === 0, 'erros de JS: ' + errors.join('; '));
});

await browser.close();
server.kill('SIGTERM');
const failed = results.filter((r) => !r.ok);
writeFileSync(OUT + 'results.json', JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} cenários passaram. Capturas em e2e/out/`);
process.exit(failed.length ? 1 : 0);
