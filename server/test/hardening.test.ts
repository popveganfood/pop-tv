// Regressões da revisão de segurança.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, CONSOLACAO, fixture } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
let admin: Awaited<ReturnType<typeof t.login>>;
before(async () => {
  t = await setup();
  await t.createUser('admin@pop.test', 'admin', { all_units: true });
  admin = await t.login('admin@pop.test');
});
after(() => t.cleanup());

test('X-Forwarded-For forjado não burla o limite de login', async () => {
  const codes = [];
  for (let i = 0; i < 12; i++) {
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json', 'x-forwarded-for': `6.6.6.${i}, 10.0.0.9` }, payload: JSON.stringify({ email: `x${i}@pop.test`, password: 'errada-123' }) });
    codes.push(r.statusCode);
  }
  assert.ok(codes.includes(429), codes.join(','));
});

test('URL de envio não troca o arquivo depois de conferido', async () => {
  const buf = fixture('img.png');
  const r = await admin('POST', '/api/media/uploads', { name: 'a.png', mime: 'image/png', size: buf.length });
  assert.match(r.json.upload.url, /uploads\//);
  await t.app.inject({ method: 'PUT', url: r.json.upload.url, headers: { 'content-type': 'image/png' }, payload: buf });
  const done = await admin('POST', `/api/media/${r.json.id}/complete`, {});
  assert.match((await t.one('select storage_key from media_assets where id = $1', [done.json.id])).storage_key, /^media\//);
  // reenviar outro conteúdo pela mesma URL não afeta o arquivo publicado
  await t.app.inject({ method: 'PUT', url: r.json.upload.url, headers: { 'content-type': 'image/png' }, payload: fixture('fake.jpg') });
  const got = await t.app.inject({ method: 'GET', url: done.json.url });
  assert.equal(got.statusCode, 200);
  assert.equal(got.rawPayload.subarray(0, 4).toString('hex'), '89504e47');
});

test('grupo entre unidades exige acesso a todas as unidades', async () => {
  const unitB = (await admin('POST', '/api/units', { name: 'B' })).json.id;
  await t.createUser('mkt@pop.test', 'marketing', { unit_ids: [unitB] });
  const mkt = await t.login('mkt@pop.test');
  const g = (await admin('POST', '/api/groups', { name: 'Rede toda', unit_id: null })).json;
  const p = (await admin('POST', '/api/playlists', { name: 'P' })).json;
  assert.equal((await mkt('POST', '/api/schedules', { name: 'x', playlist_id: p.id, target_type: 'group', target_id: g.id, priority: 50 })).status, 403);
  assert.equal((await admin('POST', '/api/schedules', { name: 'x', playlist_id: p.id, target_type: 'group', target_id: g.id, priority: 50 })).status, 200);
});

test('calendário com data inválida responde 400', async () => {
  assert.equal((await admin('GET', `/api/calendar?unit_id=${CONSOLACAO}&from=lixo`)).status, 400);
});

test('configuração falha fechado sem NODE_ENV', async () => {
  const { execFileSync } = await import('node:child_process');
  let msg = '';
  try {
    execFileSync(process.execPath, ['-e', "import('./server/src/config.ts').then(m => m.assertConfig())"], { env: { PATH: process.env.PATH, STORAGE_DRIVER: 'local' }, stdio: 'pipe' });
  } catch (e: any) { msg = String(e.stderr); }
  assert.match(msg, /proibido em produção/);
  assert.match(msg, /APP_SECRET/);
});
