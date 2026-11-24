// Excluir telas e arquivos de mídia pelo painel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
let admin: Awaited<ReturnType<typeof t.login>>;

before(async () => {
  t = await setup();
  await t.createUser('admin@pop.test', 'admin', { all_units: true });
  await t.createUser('mkt@pop.test', 'marketing', { all_units: true });
  admin = await t.login('admin@pop.test');
});
after(() => t.cleanup());

test('excluir arquivo fora de uso', async () => {
  const a = (await t.upload(admin, 'img.png', 'image/png', 'Solta')).json.id;
  assert.equal((await admin('DELETE', `/api/media/${a}`)).status, 200);
  assert.ok(!(await admin('GET', '/api/media')).json.some((m: any) => m.id === a), 'sai da biblioteca');
});

test('arquivo em uso: recusa sem confirmação; com ?retirar=1 sai das playlists e republica', async () => {
  const keep = (await t.upload(admin, 'img.jpg', 'image/jpeg', 'Fica')).json.id;
  const gone = (await t.upload(admin, 'img.png', 'image/png', 'Sai')).json.id;
  const p = (await admin('POST', '/api/playlists', { name: 'Mista' })).json;
  await admin('PUT', `/api/playlists/${p.id}/items`, { items: [{ media_id: keep }, { media_id: gone }] });
  assert.equal((await admin('POST', `/api/playlists/${p.id}/publish`, {})).json.version, 1);
  const tv = await t.pairTv(admin, { name: 'TV Excluir' });
  await admin('POST', '/api/schedules', { name: 'Mista na TV', playlist_id: p.id, target_type: 'screen', target_id: tv.id, priority: 10 });

  const list = (await admin('GET', '/api/media')).json;
  assert.equal(list.find((m: any) => m.id === gone).used_in, 1);
  const refused = await admin('DELETE', `/api/media/${gone}`);
  assert.equal(refused.status, 409);

  const r = await admin('DELETE', `/api/media/${gone}?retirar=1`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.republished, ['Mista (v2)']);
  const draft = (await admin('GET', `/api/playlists/${p.id}`)).json;
  assert.deepEqual(draft.items.map((i: any) => i.media_id), [keep], 'saiu do rascunho');
  const s = await tv.sync();
  assert.deepEqual(s.json.manifest.items.map((i: any) => i.name), ['Fica'], 'a TV recebe a versão sem o arquivo');
});

test('não exclui se uma playlist publicada ficaria vazia', async () => {
  const only = (await t.upload(admin, 'img.jpg', 'image/jpeg', 'Única')).json.id;
  const p = (await admin('POST', '/api/playlists', { name: 'Só uma' })).json;
  await admin('PUT', `/api/playlists/${p.id}/items`, { items: [{ media_id: only }] });
  await admin('POST', `/api/playlists/${p.id}/publish`, {});
  const r = await admin('DELETE', `/api/media/${only}?retirar=1`);
  assert.equal(r.status, 400);
  assert.match(r.json.error ?? r.json.message, /Só uma/);
  assert.ok((await admin('GET', '/api/media')).json.some((m: any) => m.id === only), 'continua na biblioteca');
});

test('excluir tela: sai do painel e a credencial da TV para de valer', async () => {
  const tv = await t.pairTv(admin, { name: 'TV Some' });
  assert.equal((await tv.sync()).status, 200);
  const mkt = await t.login('mkt@pop.test');
  assert.equal((await mkt('DELETE', `/api/screens/${tv.id}`)).status, 403, 'marketing não exclui tela');
  assert.equal((await admin('DELETE', `/api/screens/${tv.id}`)).status, 200);
  assert.ok(!(await admin('GET', '/api/screens')).json.some((s: any) => s.id === tv.id));
  assert.equal((await tv.sync()).status, 401);
});
