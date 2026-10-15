import type { FastifyInstance } from 'fastify';
import { q, one } from '../db.ts';
import { user, assertPublish, assertUnit, seesAllUnits, canAccessUnit, bad, notFound, HttpError, type User } from '../auth.ts';
import { audit } from '../audit.ts';
import {
  validateRule, findConflicts, blocks, naive, localNaive, fromLocal, activeAtLocal, targets, PRIORITY_LABEL,
  type Rule,
} from '../schedule.ts';
import { snapshot, decide, signedUrl } from '../resolver.ts';

const uuid = { type: 'string', format: 'uuid' };
// null primeiro: com coerceTypes o Ajv transformaria null em "" no ramo string
const nullable = (s: object) => ({ anyOf: [{ type: 'null' }, s] });
const ruleBody = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 }, playlist_id: uuid,
    target_type: { type: 'string', enum: ['all', 'unit', 'group', 'screen'] }, target_id: nullable(uuid),
    priority: { type: 'integer', enum: [10, 50, 100] },
    start_at: nullable({ type: 'string', maxLength: 25 }), end_at: nullable({ type: 'string', maxLength: 25 }),
    time_start: nullable({ type: 'string', maxLength: 8 }), time_end: nullable({ type: 'string', maxLength: 8 }),
    weekdays: nullable({ type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, maxItems: 7 }),
    enabled: { type: 'boolean' },
  },
};
type RB = Partial<Rule>;

const FIELDS = ['name', 'playlist_id', 'target_type', 'target_id', 'priority', 'start_at', 'end_at', 'time_start', 'time_end', 'weekdays', 'enabled'] as const;

/** telas e unidades atingidas por uma regra (do snapshot em memória) */
async function reach(r: Pick<Rule, 'target_type' | 'target_id'>) {
  const s = await snapshot();
  const screens = [...s.screens.values()].filter((sc) => targets(r as Rule, sc));
  let units = [...new Set(screens.map((x) => x.unit_id))];
  if (r.target_type === 'unit') units = [r.target_id!];
  if (r.target_type === 'group') {
    const g = await one('select unit_id from screen_groups where id = $1', [r.target_id]);
    if (g?.unit_id && !units.includes(g.unit_id)) units.push(g.unit_id);
  }
  return { screens, units };
}

/** grupo entre unidades pode ganhar telas de qualquer unidade: exige acesso a todas */
async function crossUnitGroup(r: Pick<Rule, 'target_type' | 'target_id'>) {
  if (r.target_type !== 'group') return false;
  const g = await one('select unit_id from screen_groups where id = $1', [r.target_id]);
  return !!g && !g.unit_id;
}

async function checkTarget(r: RB) {
  if (r.target_type === 'all') return;
  const table = { unit: 'units', group: 'screen_groups', screen: 'screens' }[r.target_type!];
  if (!(await one(`select 1 from ${table} where id = $1`, [r.target_id]))) throw bad('O alvo escolhido não existe mais.');
}

async function prepare(me: User, b: RB, selfId?: string) {
  const err = validateRule(b);
  if (err) throw bad(err);
  if (b.target_type === 'all') b.target_id = null;
  if (b.weekdays && b.weekdays.length === 7) b.weekdays = null;
  await checkTarget(b);
  if (!(await one('select 1 from playlists where id = $1', [b.playlist_id]))) throw bad('A playlist escolhida não existe mais.');
  const { screens, units } = await reach(b as Rule);
  assertPublish(me, units, b.target_type === 'all' || (await crossUnitGroup(b as Rule)));
  const s = await snapshot();
  const candidate = { ...b, id: selfId ?? 'novo', created_at: new Date().toISOString(), enabled: b.enabled ?? true } as Rule;
  const screensOf = (r: Rule) => new Set([...s.screens.values()].filter((sc) => targets(r, sc)).map((x) => x.id));
  const conflicts = findConflicts(candidate, s.rules.filter((r) => r.id !== selfId), screensOf).map((c) => ({
    id: c.rule.id, name: c.rule.name, at: c.at,
    screens: c.screens.map((id) => s.screens.get(id)?.name ?? id),
  }));
  return { conflicts, affected: screens.length };
}

async function describeTarget(r: { target_type: string; target_id: string | null }) {
  if (r.target_type === 'all') return 'Todas as unidades';
  const t = { unit: ['units', 'Unidade'], group: ['screen_groups', 'Grupo'], screen: ['screens', 'Tela'] }[r.target_type]!;
  const row = await one(`select name from ${t[0]} where id = $1`, [r.target_id]);
  return `${t[1]}: ${row?.name ?? '(removido)'}`;
}

function conflictError(conflicts: { name: string; at: string; screens: string[] }[]) {
  const c = conflicts[0];
  return new HttpError(409,
    `Conflito com "${c.name}": mesma prioridade e mesmo tipo de alvo no ar ao mesmo tempo (ex.: ${c.at.replace('T', ' ')}, ${c.screens.slice(0, 3).join(', ')}). ` +
    'Mude a prioridade, o horário ou o alvo.', { conflicts });
}

export default async function scheduleRoutes(app: FastifyInstance) {
  app.get('/api/schedules', async (req) => {
    const me = user(req);
    const rows = await q(`select sc.*, p.name as playlist_name, u.name as created_by_name, (p.published_version_id is not null) as playlist_published
                            from schedules sc join playlists p on p.id = sc.playlist_id left join users u on u.id = sc.created_by
                           order by sc.priority desc, sc.created_at desc`);
    const out = [];
    for (const r of rows) {
      const { units, screens } = await reach(r);
      if (!seesAllUnits(me) && (r.target_type === 'all' || !units.some((id) => canAccessUnit(me, id)))) continue;
      const now = new Date();
      const liveOn = screens.filter((sc) => activeAtLocal(r, localNaive(now, sc.timezone))).length;
      out.push({ ...r, target_label: await describeTarget(r), priority_label: PRIORITY_LABEL[r.priority], screen_count: screens.length, active_now_on: r.enabled ? liveOn : 0, can_edit: canEdit(me, r.target_type, units) });
    }
    return out;
  });

  const canEdit = (me: User, tt: string, units: string[]) => { try { assertPublish(me, units, tt === 'all'); return true; } catch { return false; } };

  app.post<{ Body: RB }>('/api/schedules/check', { schema: { body: ruleBody } }, async (req) => {
    const b = { priority: 10, ...req.body };
    const err = validateRule(b);
    if (err) return { error: err, conflicts: [], affected: 0 };
    return prepare(user(req), b, (req.query as any).id);
  });

  app.post<{ Body: RB }>('/api/schedules', { schema: { body: { ...ruleBody, required: ['name', 'playlist_id', 'target_type', 'priority'] } } }, async (req) => {
    const me = user(req);
    const b = req.body;
    const { conflicts } = await prepare(me, b);
    if (conflicts.length) throw conflictError(conflicts);
    const r = await one(`insert into schedules(${FIELDS.join(',')}, created_by) values (${FIELDS.map((_, i) => '$' + (i + 1)).join(',')}, $${FIELDS.length + 1}) returning *`,
      [...FIELDS.map((f) => (f === 'enabled' ? b.enabled ?? true : (b as any)[f] ?? null)), me.id]);
    await audit(me, 'publicar', 'programação', r.id, `Criou a programação "${r.name}" (${PRIORITY_LABEL[r.priority]}, ${await describeTarget(r)})`, b);
    return r;
  });

  app.patch<{ Params: { id: string }; Body: RB }>('/api/schedules/:id', { schema: { body: ruleBody } }, async (req) => {
    const me = user(req);
    const cur = await one('select * from schedules where id = $1', [req.params.id]);
    if (!cur) throw notFound('Programação');
    assertPublish(me, (await reach(cur)).units, cur.target_type === 'all' || (await crossUnitGroup(cur))); // pode mexer na atual?
    const b = { ...cur, ...req.body };
    const { conflicts } = await prepare(me, b, cur.id);
    if (conflicts.length) throw conflictError(conflicts);
    const r = await one(`update schedules set ${FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1 returning *`,
      [cur.id, ...FIELDS.map((f) => (b as any)[f] ?? (f === 'enabled' ? true : null))]);
    await audit(me, 'editar', 'programação', r.id, `Editou a programação "${r.name}"`, req.body);
    return r;
  });

  app.delete<{ Params: { id: string } }>('/api/schedules/:id', async (req) => {
    const me = user(req);
    const cur = await one('select * from schedules where id = $1', [req.params.id]);
    if (!cur) throw notFound('Programação');
    assertPublish(me, (await reach(cur)).units, cur.target_type === 'all' || (await crossUnitGroup(cur)));
    await q('delete from schedules where id = $1', [cur.id]);
    await audit(me, 'remover', 'programação', cur.id, `Removeu a programação "${cur.name}"`);
    return { ok: true };
  });

  // O que esta tela exibe agora (ou num horário local escolhido) e por quê
  app.get<{ Params: { id: string }; Querystring: { at?: string } }>('/api/screens/:id/resolve', async (req) => {
    const sc = await one('select s.unit_id, u.timezone from screens s join units u on u.id = s.unit_id where s.id = $1', [req.params.id]);
    if (!sc) throw notFound('Tela');
    assertUnit(user(req), sc.unit_id);
    let at = new Date();
    if (req.query.at) {
      try { at = fromLocal(naive(req.query.at), sc.timezone); } catch { throw bad('Data/hora inválida.'); }
    }
    const d = await decide(req.params.id, at);
    if (!d) throw notFound('Tela');
    const items = await Promise.all((d.playlist?.items ?? []).map(async (it) => ({
      ...it, url: await signedUrl(it.key), thumb_url: it.thumb_key ? await signedUrl(it.thumb_key) : it.kind === 'image' ? await signedUrl(it.key) : null,
    })));
    return {
      screen: { id: d.screen.id, name: d.screen.name, orientation: d.screen.orientation, timezone: sc.timezone },
      local_time: d.localTime, source: d.source, explanation: d.explanation,
      rule: d.rule && { id: d.rule.id, name: d.rule.name, priority: d.rule.priority, priority_label: PRIORITY_LABEL[d.rule.priority], target_type: d.rule.target_type },
      overridden: d.active.filter((r) => r.id !== d.rule?.id).map((r) => ({ id: r.id, name: r.name, priority_label: PRIORITY_LABEL[r.priority], target_type: r.target_type })),
      playlist: d.playlist && { id: d.playlist.id, name: d.playlist.name, version: d.playlist.version },
      items,
    };
  });

  // Calendário de uma unidade: blocos de cada regra que atinge alguma tela da unidade
  app.get<{ Querystring: { unit_id: string; from?: string; days?: number } }>('/api/calendar', async (req) => {
    const me = user(req);
    const unitId = req.query.unit_id;
    if (!unitId) throw bad('Escolha a unidade.');
    assertUnit(me, unitId);
    const unit = await one('select id, name, timezone from units where id = $1', [unitId]);
    if (!unit) throw notFound('Unidade');
    const s = await snapshot();
    const screens = [...s.screens.values()].filter((x) => x.unit_id === unitId);
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 31);
    if (req.query.from && !/^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) throw bad('Data inválida.');
    const fromLocalMs = req.query.from ? naive(`${req.query.from} 00:00`) : (() => { const n = localNaive(new Date(), unit.timezone); return n - (n % 86400000); })();
    const names = await q('select id, name from playlists');
    const pn = new Map(names.map((p) => [p.id, p.name]));
    const rules = s.rules.filter((r) => r.target_type === 'all' || (r.target_type === 'unit' && r.target_id === unitId) || screens.some((sc) => targets(r, sc)));
    return {
      unit, from: new Date(fromLocalMs).toISOString().slice(0, 10), days,
      rules: await Promise.all(rules.map(async (r) => ({
        id: r.id, name: r.name, priority: r.priority, priority_label: PRIORITY_LABEL[r.priority], target_type: r.target_type,
        target_label: await describeTarget(r), playlist_name: pn.get(r.playlist_id),
        screens: screens.filter((sc) => targets(r, sc)).map((sc) => sc.name),
        blocks: blocks(r, fromLocalMs, days),
      }))),
    };
  });
}
