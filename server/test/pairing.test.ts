import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, CONSOLACAO } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
let admin: Awaited<ReturnType<typeof t.login>>;
before(async () => {
  t = await setup();
  await t.createUser('admin@pop.test', 'admin', { all_units: true });
  admin = await t.login('admin@pop.test');
});
after(() => t.cleanup());

test('login recusa senha errada e exige sessão nas rotas do painel', async () => {
  assert.equal((await t.api('POST', '/api/auth/login', { email: 'admin@pop.test', password: 'errada-123' })).status, 401);
  assert.equal((await t.api('GET', '/api/units')).status, 401);
  assert.equal((await admin('GET', '/api/auth/me')).json.user.role, 'admin');
});

test('mutação sem JSON é recusada (proteção CSRF)', async () => {
  const r = await t.app.inject({ method: 'POST', url: '/api/units', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'name=x' });
  assert.equal(r.statusCode, 415);
});

test('pareamento: código de uso único, credencial própria, TV passa a sincronizar (critério 3)', async () => {
  const start = await t.api('POST', '/api/player/pair/start');
  assert.equal(start.status, 200);
  assert.match(start.json.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal((await t.api('POST', '/api/player/pair/poll', { poll_token: start.json.poll_token })).json.status, 'waiting');

  const wrong = await admin('POST', '/api/pairing/claim', { code: 'ZZZZZZ', unit_id: CONSOLACAO, name: 'X' });
  assert.equal(wrong.status, 404);

  // código digitado com espaço/minúscula também vale
  const code = start.json.code.toLowerCase().replace(/(...)/, '$1 ');
  const claim = await admin('POST', '/api/pairing/claim', { code, unit_id: CONSOLACAO, name: 'TV Salão 01', orientation: 'landscape' });
  assert.equal(claim.status, 200, JSON.stringify(claim.json));

  const again = await admin('POST', '/api/pairing/claim', { code: start.json.code, unit_id: CONSOLACAO, name: 'Outra' });
  assert.equal(again.status, 404, 'código não pode ser reutilizado');

  const poll = await t.api('POST', '/api/player/pair/poll', { poll_token: start.json.poll_token });
  assert.equal(poll.json.status, 'paired');
  assert.ok(poll.json.device_token.length > 30);
  assert.ok(poll.cookies.some((c) => c.name === 'pop_device'));
  assert.equal((await t.api('POST', '/api/player/pair/poll', { poll_token: start.json.poll_token })).json.status, 'expired', 'credencial é entregue uma vez só');

  const stored = await t.one('select token_hash from device_credentials where screen_id = $1', [claim.json.id]);
  assert.notEqual(stored.token_hash, poll.json.device_token, 'só o hash é guardado');

  const sync = await t.api('POST', '/api/player/sync', { state: 'idle' }, { authorization: `Bearer ${poll.json.device_token}` });
  assert.equal(sync.status, 200);
  assert.equal(sync.json.changed, true);
  assert.equal(sync.json.manifest.source, 'nenhuma'); // playlist de segurança ainda vazia
  const screens = (await admin('GET', '/api/screens')).json;
  assert.equal(screens.length, 1);
  assert.equal(screens[0].online, true);
  assert.equal(screens[0].paired, true);
});

test('código expirado é recusado', async () => {
  const start = await t.api('POST', '/api/player/pair/start');
  await t.q(`update pairing_sessions set expires_at = now() - interval '1 minute' where code = $1`, [start.json.code]);
  assert.equal((await admin('POST', '/api/pairing/claim', { code: start.json.code, unit_id: CONSOLACAO, name: 'X' })).status, 404);
  assert.equal((await t.api('POST', '/api/player/pair/poll', { poll_token: start.json.poll_token })).json.status, 'expired');
});

test('revogação: credencial revogada não acessa mais (critério 18) e refazer pareamento funciona', async () => {
  const tv = await t.pairTv(admin);
  assert.equal((await tv.sync()).status, 200);
  assert.equal((await admin('POST', `/api/screens/${tv.id}/revoke`, {})).json.revoked, 1);
  const denied = await tv.sync();
  assert.equal(denied.status, 401);
  assert.equal((await t.api('POST', '/api/player/sync', {}, { cookie: `pop_device=${tv.token}` })).status, 401);

  const start = await t.api('POST', '/api/player/pair/start');
  assert.equal((await admin('POST', `/api/screens/${tv.id}/repair`, { code: start.json.code })).status, 200);
  const poll = await t.api('POST', '/api/player/pair/poll', { poll_token: start.json.poll_token });
  assert.equal(poll.json.screen_id, tv.id, 'mesma tela, nova credencial');
  assert.equal((await t.api('POST', '/api/player/sync', {}, { authorization: `Bearer ${poll.json.device_token}` })).status, 200);
});

test('TV offline após a tolerância (critério 12)', async () => {
  const tv = await t.pairTv(admin);
  await tv.sync();
  let s = (await admin('GET', `/api/screens/${tv.id}`)).json;
  assert.equal(s.online, true);
  await t.q(`update screens set last_seen_at = now() - interval '91 seconds' where id = $1`, [tv.id]);
  s = (await admin('GET', `/api/screens/${tv.id}`)).json;
  assert.equal(s.online, false);
});

test('tentativas excessivas de código são bloqueadas', async () => {
  await t.createUser('brute@pop.test', 'admin', { all_units: true });
  const b = await t.login('brute@pop.test');
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await b('POST', '/api/pairing/claim', { code: 'AAAA' + i, unit_id: CONSOLACAO, name: 'X' })).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(404));
  assert.equal(codes[10], 429);
});

test('erros reportados pela TV ficam registrados', async () => {
  const tv = await t.pairTv(admin);
  await tv.sync({ error: 'Falha ao carregar video.mp4', state: 'playing' });
  await tv.sync({ error: 'Falha ao carregar video.mp4', state: 'playing' }); // repetido não duplica
  const logs = (await admin('GET', `/api/screens/${tv.id}/logs`)).json;
  assert.equal(logs.length, 1);
  assert.equal((await admin('GET', `/api/screens/${tv.id}`)).json.last_error, 'Falha ao carregar video.mp4');
});
