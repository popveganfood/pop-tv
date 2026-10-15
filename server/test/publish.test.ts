import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, CONSOLACAO, FALLBACK } from './helpers.ts';

let t: Awaited<ReturnType<typeof setup>>;
let admin: Awaited<ReturnType<typeof t.login>>;
let img1: string, img2: string, video: string;
let tv1: Awaited<ReturnType<typeof t.pairTv>>, tv2: Awaited<ReturnType<typeof t.pairTv>>;
let unitB: string;

const names = (sync: any) => sync.json.manifest?.items.map((i: any) => i.name);

before(async () => {
  t = await setup();
  await t.createUser('admin@pop.test', 'admin', { all_units: true });
  admin = await t.login('admin@pop.test');
  unitB = (await admin('POST', '/api/units', { name: 'Unidade Teste', city: 'São Paulo', state: 'SP', timezone: 'America/Sao_Paulo' })).json.id;
  tv1 = await t.pairTv(admin, { name: 'TV 01' });
  tv2 = await t.pairTv(admin, { name: 'TV 02' });
});
after(() => t.cleanup());

test('unidade e ambientes (critérios 1 e 2)', async () => {
  const env = await admin('POST', `/api/units/${unitB}/environments`, { name: 'Área externa' });
  assert.equal(env.status, 200);
  const envs = (await admin('GET', `/api/units/${unitB}/environments`)).json;
  assert.deepEqual(envs.map((e: any) => e.name), ['Área externa']);
  assert.equal((await admin('POST', '/api/units', { name: 'X', timezone: 'Lua/Base' })).status, 400);
  const dup = await admin('POST', `/api/units/${CONSOLACAO}/duplicate`, { name: 'Consolação 2', copy_environments: true });
  assert.deepEqual((await admin('GET', `/api/units/${dup.json.id}/environments`)).json.map((e: any) => e.name), ['Salão', 'Entrada', 'Caixa']);
  assert.equal((await admin('POST', `/api/units/${dup.json.id}/archive`, {})).status, 200);
  assert.ok(!(await admin('GET', '/api/units')).json.some((u: any) => u.id === dup.json.id));
  assert.ok((await admin('GET', '/api/units?archived=1')).json.some((u: any) => u.id === dup.json.id), 'arquivada não é apagada');
});

test('upload de imagens e vídeo reais com validação (critério 4)', async () => {
  const a = await t.upload(admin, 'img.png', 'image/png', 'Promo burger.png');
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.width, 640);
  assert.equal(a.json.name, 'Promo burger');
  img1 = a.json.id;
  img2 = (await t.upload(admin, 'img.jpg', 'image/jpeg', 'Almoço')).json.id;
  const v = await t.upload(admin, 'h264-faststart.mp4', 'video/mp4', 'Institucional');
  assert.equal(v.json.codec, 'avc1');
  assert.equal(v.json.compat, 'ok');
  assert.ok(v.json.duration_ms > 1500);
  video = v.json.id;

  const fake = await t.upload(admin, 'fake.jpg', 'image/jpeg');
  assert.equal(fake.status, 422);
  assert.equal((await admin('GET', '/api/media')).json.length, 3, 'arquivo inválido não fica na biblioteca');
  assert.equal((await admin('POST', '/api/media/uploads', { name: 'x.gif', mime: 'image/gif', size: 10 })).status, 400);
});

test('playlist, rascunho, publicação e TV recebe nova versão (critérios 5, 7, 10)', async () => {
  const p = (await admin('POST', '/api/playlists', { name: 'Burger POP' })).json;
  assert.equal((await admin('POST', `/api/playlists/${p.id}/publish`, {})).status, 400, 'playlist vazia não publica');
  assert.equal((await admin('PUT', `/api/playlists/${p.id}/items`, { items: [{ media_id: img1, duration_ms: 5000 }, { media_id: video }] })).status, 200);
  assert.equal((await admin('POST', `/api/playlists/${p.id}/publish`, {})).json.version, 1);

  const before1 = await tv1.sync();
  const before2 = await tv2.sync();
  assert.equal(before1.json.manifest.source, 'nenhuma');

  // publicar só na TV 01
  const rule = await admin('POST', '/api/schedules', { name: 'Burger na TV 01', playlist_id: p.id, target_type: 'screen', target_id: tv1.id, priority: 10 });
  assert.equal(rule.status, 200, JSON.stringify(rule.json));
  const s1 = await tv1.sync({ version: before1.json.manifest.version, url_epoch: before1.json.manifest.url_epoch });
  assert.equal(s1.json.changed, true);
  assert.deepEqual(names(s1), ['Promo burger', 'Institucional']);
  assert.equal(s1.json.manifest.items[0].duration_ms, 5000);
  assert.equal(s1.json.manifest.items[1].duration_ms, null, 'vídeo toca até o fim');
  const s2 = await tv2.sync({ version: before2.json.manifest.version, url_epoch: before2.json.manifest.url_epoch });
  assert.equal(s2.json.changed, false, 'TV 02 não foi afetada');

  // nada mudou → resposta curta
  const again = await tv1.sync({ version: s1.json.manifest.version, url_epoch: s1.json.manifest.url_epoch, state: 'playing' });
  assert.deepEqual(again.json, { changed: false, poll_seconds: 30 });
  let screen = (await admin('GET', `/api/screens/${tv1.id}`)).json;
  assert.equal(screen.in_sync, true, 'TV confirmou a versão esperada');

  // editar e publicar v2 → TV detecta
  await admin('PUT', `/api/playlists/${p.id}/items`, { items: [{ media_id: img2, duration_ms: 15000 }] });
  screen = (await admin('GET', `/api/screens/${tv1.id}`)).json;
  assert.equal(screen.in_sync, true, 'rascunho não muda a TV');
  await admin('POST', `/api/playlists/${p.id}/publish`, {});
  screen = (await admin('GET', `/api/screens/${tv1.id}`)).json;
  assert.equal(screen.in_sync, false, 'publicado no servidor ≠ recebido pela TV');
  const s3 = await tv1.sync({ version: s1.json.manifest.version, url_epoch: s1.json.manifest.url_epoch });
  assert.deepEqual(names(s3), ['Almoço']);
  await tv1.sync({ version: s3.json.manifest.version, url_epoch: s3.json.manifest.url_epoch });
  assert.equal((await admin('GET', `/api/screens/${tv1.id}`)).json.in_sync, true);

  // restaurar v1 (critério 16)
  const versions = (await admin('GET', `/api/playlists/${p.id}/versions`)).json;
  assert.deepEqual(versions.map((v: any) => v.version), [2, 1]);
  const v1 = versions.find((v: any) => v.version === 1);
  assert.equal((await admin('POST', `/api/playlists/${p.id}/versions/${v1.id}/restore`, {})).json.version, 3);
  assert.deepEqual(names(await tv1.sync({ version: s3.json.manifest.version, url_epoch: 0 })), ['Promo burger', 'Institucional']);
  const detail = (await admin('GET', `/api/playlists/${p.id}`)).json;
  assert.equal(detail.items.length, 2, 'rascunho reflete a versão restaurada');
  assert.equal(detail.has_unpublished_changes, false);

  // mídia em uso não pode ser excluída
  const del = await admin('DELETE', `/api/media/${img1}`);
  assert.equal(del.status, 409);
  assert.equal(del.json.usage.playlists[0].name, 'Burger POP');
});

test('grupo e todas as unidades (critérios 8 e 9) + prioridade', async () => {
  const pg = (await admin('POST', '/api/playlists', { name: 'Grupo' })).json;
  await admin('PUT', `/api/playlists/${pg.id}/items`, { items: [{ media_id: img2 }] });
  await admin('POST', `/api/playlists/${pg.id}/publish`, {});
  const g = (await admin('POST', '/api/groups', { name: 'Salão', unit_id: CONSOLACAO })).json;
  assert.equal((await admin('PUT', `/api/groups/${g.id}/members`, { screen_ids: [tv2.id] })).status, 200);
  assert.equal((await admin('POST', '/api/schedules', { name: 'Grupo salão', playlist_id: pg.id, target_type: 'group', target_id: g.id, priority: 10 })).status, 200);
  assert.deepEqual(names(await tv2.sync()), ['Almoço']);
  assert.deepEqual(names(await tv1.sync()), ['Promo burger', 'Institucional'], 'TV 01 mantém a regra de tela');

  const inst = (await admin('POST', '/api/playlists', { name: 'Institucional' })).json;
  await admin('PUT', `/api/playlists/${inst.id}/items`, { items: [{ media_id: video }] });
  await admin('POST', `/api/playlists/${inst.id}/publish`, {});
  const camp = await admin('POST', '/api/schedules', { name: 'Campanha institucional', playlist_id: inst.id, target_type: 'all', priority: 50 });
  assert.equal(camp.status, 200);
  assert.deepEqual(names(await tv1.sync()), ['Institucional']);
  assert.deepEqual(names(await tv2.sync()), ['Institucional']);
  const why = (await admin('GET', `/api/screens/${tv1.id}/resolve`)).json;
  assert.equal(why.rule.name, 'Campanha institucional');
  assert.match(why.explanation, /prioridade maior/);
  assert.equal(why.overridden[0].name, 'Burger na TV 01');

  // conflito ambíguo é recusado
  const clash = await admin('POST', '/api/schedules', { name: 'Outra global', playlist_id: pg.id, target_type: 'all', priority: 50 });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.conflicts[0].name, 'Campanha institucional');
  // mas com horário que não sobrepõe é aceito
  await admin('PATCH', `/api/schedules/${camp.json.id}`, { time_start: '00:00', time_end: '06:00' });
  assert.equal((await admin('POST', '/api/schedules', { name: 'Outra global', playlist_id: pg.id, target_type: 'all', priority: 50, time_start: '06:00', time_end: '23:59' })).status, 200);

  // corpo como o painel envia (campos vazios = null) é aceito e grava null
  const explicit = await admin('POST', '/api/schedules', { name: 'Com nulls', playlist_id: pg.id, target_type: 'screen', target_id: tv2.id, priority: 50,
    enabled: true, start_at: null, end_at: null, time_start: null, time_end: null, weekdays: null });
  assert.equal(explicit.status, 200, JSON.stringify(explicit.json));
  assert.equal(explicit.json.start_at, null);
  await admin('DELETE', `/api/schedules/${explicit.json.id}`);
  assert.equal((await admin('PATCH', `/api/screens/${tv2.id}`, { environment_id: null })).status, 200);

  // emergência sem término é recusada
  assert.equal((await admin('POST', '/api/schedules', { name: 'Emergência', playlist_id: pg.id, target_type: 'all', priority: 100 })).status, 400);
});

test('playlist de segurança quando nada se aplica; regra sem conteúdo não apaga a TV', async () => {
  await admin('PUT', `/api/playlists/${FALLBACK}/items`, { items: [{ media_id: img2 }] });
  await admin('POST', `/api/playlists/${FALLBACK}/publish`, {});
  const tv3 = await t.pairTv(admin, { name: 'TV 03', unit_id: unitB });
  const empty = (await admin('POST', '/api/playlists', { name: 'Nunca publicada' })).json;
  await admin('POST', '/api/schedules', { name: 'Sem conteúdo', playlist_id: empty.id, target_type: 'screen', target_id: tv3.id, priority: 10 });
  const s = await tv3.sync();
  // regras globais (de 00–06 e 06–23:59) podem estar ativas; se não, cai na segurança
  assert.ok(['regra', 'segurança'].includes(s.json.manifest.source));
  assert.ok(s.json.manifest.items.length > 0, 'nunca fica sem conteúdo quando há segurança publicada');
  assert.equal((await admin('DELETE', `/api/playlists/${FALLBACK}`)).status, 400);
});

test('permissões no servidor (critério 17)', async () => {
  await t.createUser('gerente@pop.test', 'manager', { unit_ids: [unitB] });
  await t.createUser('mkt@pop.test', 'marketing', { unit_ids: [unitB] });
  const ger = await t.login('gerente@pop.test');
  const mkt = await t.login('mkt@pop.test');

  // gerente só vê a própria unidade
  assert.deepEqual((await ger('GET', '/api/units')).json.map((u: any) => u.name), ['Unidade Teste']);
  assert.ok((await ger('GET', '/api/screens')).json.every((s: any) => s.unit_id === unitB));
  assert.equal((await ger('GET', `/api/units/${CONSOLACAO}`)).status, 403);
  assert.equal((await ger('PATCH', `/api/units/${CONSOLACAO}`, { name: 'hack' })).status, 403);
  assert.equal((await ger('PATCH', `/api/screens/${tv1.id}`, { name: 'hack' })).status, 403);
  assert.equal((await ger('POST', `/api/screens/${tv1.id}/revoke`, {})).status, 403);
  assert.equal((await ger('POST', `/api/units/${unitB}/environments`, { name: 'x' })).status, 403, 'sem liberação de gerenciar telas');
  assert.equal((await ger('POST', '/api/playlists', { name: 'x' })).status, 403);
  assert.equal((await ger('GET', '/api/users')).status, 403);
  assert.equal((await ger('GET', `/api/screens/${tv1.id}/resolve`)).status, 403);

  // marketing publica só nas unidades autorizadas
  const p = (await mkt('POST', '/api/playlists', { name: 'Mkt' })).json;
  await mkt('PUT', `/api/playlists/${p.id}/items`, { items: [{ media_id: img2 }] });
  assert.equal((await mkt('POST', `/api/playlists/${p.id}/publish`, {})).status, 200);
  assert.equal((await mkt('POST', '/api/schedules', { name: 'na B', playlist_id: p.id, target_type: 'unit', target_id: unitB, priority: 50 })).status, 200);
  assert.equal((await mkt('POST', '/api/schedules', { name: 'na Consolação', playlist_id: p.id, target_type: 'unit', target_id: CONSOLACAO, priority: 50 })).status, 403);
  assert.equal((await mkt('POST', '/api/schedules', { name: 'todas', playlist_id: p.id, target_type: 'all', priority: 10, time_start: '01:00', time_end: '02:00' })).status, 403);
  assert.equal((await mkt('POST', '/api/schedules', { name: 'tv1', playlist_id: p.id, target_type: 'screen', target_id: tv1.id, priority: 50 })).status, 403);
  // a playlist de segurança atinge todas as unidades: marketing restrito não republica
  assert.equal((await mkt('POST', `/api/playlists/${FALLBACK}/publish`, {})).status, 403);
  // não pode apagar regra de outro escopo
  const rules = (await admin('GET', '/api/schedules')).json;
  const global = rules.find((r: any) => r.target_type === 'all');
  assert.equal((await mkt('DELETE', `/api/schedules/${global.id}`)).status, 403);
  assert.ok(!(await mkt('GET', '/api/schedules')).json.some((r: any) => r.target_type === 'all'));

  // gerente liberado
  await admin('PATCH', `/api/users/${(await t.one(`select id from users where email='gerente@pop.test'`)).id}`, { can_manage_screens: true });
  assert.equal((await ger('POST', `/api/units/${unitB}/environments`, { name: 'Caixa' })).status, 200);
});

test('dashboard com dados reais', async () => {
  const d = (await admin('GET', '/api/dashboard')).json;
  assert.equal(d.counts.screens, 3);
  assert.ok(d.counts.online >= 1);
  assert.ok(d.counts.playlists_published >= 3);
  assert.ok(d.changes.length > 0);
  assert.ok(d.changes[0].user_name);
  const audit = (await admin('GET', '/api/audit')).json;
  assert.ok(audit.some((a: any) => a.action === 'publicar' && a.user_name === 'admin@pop.test'), 'quem publicou fica registrado');
});

test('calendário da unidade', async () => {
  const c = (await admin('GET', `/api/calendar?unit_id=${CONSOLACAO}&days=7`)).json;
  const camp = c.rules.find((r: any) => r.name === 'Campanha institucional');
  assert.equal(camp.blocks.length, 7);
  assert.match(camp.blocks[0].start, /T00:00$/);
  assert.match(camp.blocks[0].end, /T06:00$/);
});
