import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, findConflicts, validateRule, activeAtLocal, naive, localNaive, blocks, type Rule, type ScreenCtx } from '../src/schedule.ts';

let n = 0;
const rule = (p: Partial<Rule>): Rule => ({
  id: 'r' + ++n, name: 'R' + n, playlist_id: 'p', target_type: 'all', target_id: null, priority: 10,
  start_at: null, end_at: null, time_start: null, time_end: null, weekdays: null, enabled: true,
  created_at: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`, ...p,
});
const tv1: ScreenCtx = { id: 's1', unit_id: 'u1', group_ids: ['g1'], timezone: 'America/Sao_Paulo' };
const tv2: ScreenCtx = { id: 's2', unit_id: 'u1', group_ids: [], timezone: 'America/Sao_Paulo' };
// 2026-10-14 (quarta) 13:59 UTC = 10:59 em São Paulo (UTC-3)
const at = (iso: string) => new Date(iso);

test('fuso horário: converte instante para hora local da unidade', () => {
  assert.equal(new Date(localNaive(at('2026-10-14T13:59:00Z'), 'America/Sao_Paulo')).toISOString().slice(0, 16), '2026-10-14T10:59');
  assert.equal(new Date(localNaive(at('2026-10-14T13:59:00Z'), 'America/Manaus')).toISOString().slice(0, 16), '2026-10-14T09:59');
});

test('agendamento começa e termina no horário local correto (critério 15)', () => {
  const base = rule({ name: 'Base' });
  const almoco = rule({ name: 'Almoço', priority: 50, time_start: '11:00', time_end: '15:00', weekdays: [1, 2, 3, 4, 5] });
  const rs = [base, almoco];
  assert.equal(resolve(rs, tv1, at('2026-10-14T13:59:00Z')).winner?.name, 'Base');   // 10:59
  assert.equal(resolve(rs, tv1, at('2026-10-14T14:00:00Z')).winner?.name, 'Almoço'); // 11:00
  assert.equal(resolve(rs, tv1, at('2026-10-14T17:59:00Z')).winner?.name, 'Almoço'); // 14:59
  assert.equal(resolve(rs, tv1, at('2026-10-14T18:00:00Z')).winner?.name, 'Base');   // 15:00
  assert.equal(resolve(rs, tv1, at('2026-10-18T14:30:00Z')).winner?.name, 'Base');   // domingo
});

test('campanha temporária sexta–domingo volta à programação anterior', () => {
  const base = rule({ name: 'Base' });
  const promo = rule({ name: 'Promo', priority: 50, start_at: '2026-10-16 00:00', end_at: '2026-10-19 00:00' });
  assert.equal(resolve([base, promo], tv1, at('2026-10-16T02:59:00Z')).winner?.name, 'Base'); // qui 23:59
  assert.equal(resolve([base, promo], tv1, at('2026-10-16T03:00:00Z')).winner?.name, 'Promo'); // sex 00:00
  assert.equal(resolve([base, promo], tv1, at('2026-10-19T02:59:00Z')).winner?.name, 'Promo'); // dom 23:59
  assert.equal(resolve([base, promo], tv1, at('2026-10-19T03:00:00Z')).winner?.name, 'Base');  // seg 00:00
});

test('janela que atravessa a meia-noite usa o dia de início', () => {
  const noite = rule({ time_start: '18:00', time_end: '02:00', weekdays: [5] }); // sexta
  assert.ok(activeAtLocal(noite, naive('2026-10-16 23:00'))); // sexta 23h
  assert.ok(activeAtLocal(noite, naive('2026-10-17 01:59'))); // sábado 01:59 (janela de sexta)
  assert.ok(!activeAtLocal(noite, naive('2026-10-17 02:00')));
  assert.ok(!activeAtLocal(noite, naive('2026-10-17 23:00'))); // sábado não está nos dias
});

test('prioridade e especificidade: tela > grupo > unidade > todas; emergência vence tudo', () => {
  const global = rule({ name: 'Global' });
  const unidade = rule({ name: 'Unidade', target_type: 'unit', target_id: 'u1' });
  const tela = rule({ name: 'Entrada', target_type: 'screen', target_id: 's1' });
  const t = at('2026-10-14T15:00:00Z');
  assert.equal(resolve([global, unidade, tela], tv1, t).winner?.name, 'Entrada');
  assert.equal(resolve([global, unidade, tela], tv2, t).winner?.name, 'Unidade');
  const camp = rule({ name: 'Campanha global', priority: 50 });
  assert.equal(resolve([global, unidade, tela, camp], tv1, t).winner?.name, 'Campanha global');
  const emerg = rule({ name: 'Emergência', priority: 100, target_type: 'group', target_id: 'g1', end_at: '2030-01-01 00:00' });
  const r = resolve([global, unidade, tela, camp, emerg], tv1, t);
  assert.equal(r.winner?.name, 'Emergência');
  assert.match(r.explanation, /prioridade maior/);
  assert.equal(resolve([global, unidade, tela, camp, emerg], tv2, t).winner?.name, 'Campanha global');
});

test('regra desativada ou expirada não vale; sem regra → segurança', () => {
  const r = resolve([rule({ enabled: false }), rule({ end_at: '2020-01-01 00:00' })], tv1, at('2026-10-14T15:00:00Z'));
  assert.equal(r.winner, null);
  assert.match(r.explanation, /segurança/);
});

test('conflito: mesma prioridade, mesmo nível, mesma tela e horário sobreposto', () => {
  const screensOf = (r: Rule) => new Set(r.target_type === 'screen' ? [r.target_id!] : ['s1', 's2']);
  const a = rule({ priority: 50, time_start: '11:00', time_end: '15:00', weekdays: [1] });
  const b = rule({ priority: 50, time_start: '14:00', time_end: '18:00', weekdays: [1, 2] });
  const c = rule({ priority: 50, time_start: '15:00', time_end: '18:00', weekdays: [1] }); // encosta, não sobrepõe
  const d = rule({ priority: 10, time_start: '11:00', time_end: '15:00' }); // prioridade diferente
  const e = rule({ priority: 50, time_start: '11:00', time_end: '15:00', start_at: '2026-10-16 00:00', end_at: '2026-10-18 00:00', weekdays: [1] }); // sex–sáb: segunda nunca ocorre
  const found = findConflicts(a, [b, c, d, e], screensOf);
  assert.deepEqual(found.map((f) => f.rule.id), [b.id]);
  assert.match(found[0].at, /T14:00$/);
});

test('validação: emergência exige término; horários e dias válidos', () => {
  assert.match(validateRule({ name: 'x', playlist_id: 'p', target_type: 'all', priority: 100 })!, /término/);
  assert.match(validateRule({ name: 'x', playlist_id: 'p', target_type: 'unit', priority: 10 })!, /unidade/);
  assert.match(validateRule({ name: 'x', playlist_id: 'p', target_type: 'all', priority: 10, time_start: '10:00' })!, /hora/);
  assert.match(validateRule({ name: 'x', playlist_id: 'p', target_type: 'all', priority: 10, weekdays: [] })!, /dia/);
  assert.equal(validateRule({ name: 'x', playlist_id: 'p', target_type: 'all', priority: 10, time_start: '22:00', time_end: '02:00' }), null);
});

test('blocos do calendário', () => {
  const r = rule({ time_start: '11:00', time_end: '15:00', weekdays: [3] });
  const b = blocks(r, naive('2026-10-12 00:00'), 7);
  assert.deepEqual(b, [{ start: '2026-10-14T11:00', end: '2026-10-14T15:00' }]);
});
