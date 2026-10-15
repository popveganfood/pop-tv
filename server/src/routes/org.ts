import type { FastifyInstance } from 'fastify';
import { q, one, tx } from '../db.ts';
import {
  user, assertAdmin, assertUnit, assertManageScreens, assertPublish, seesAllUnits, canAccessUnit,
  bad, notFound, type User,
} from '../auth.ts';
import { audit } from '../audit.ts';
import { limit } from '../ratelimit.ts';
import { isValidTimeZone } from '../schedule.ts';
import { decide, contentVersion, snapshot, signedUrl } from '../resolver.ts';

const uuid = { type: 'string', format: 'uuid' };
const str = (max = 200) => ({ type: 'string', maxLength: max });

const unitFields = ['name', 'address', 'city', 'state', 'timezone', 'contact_name', 'contact_phone', 'contact_email', 'image_media_id', 'active'] as const;
const unitBody = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 }, address: str(300), city: str(120), state: str(40),
    timezone: str(64), contact_name: str(120), contact_phone: str(60), contact_email: str(200),
    image_media_id: { anyOf: [{ type: 'null' }, uuid] }, active: { type: 'boolean' },
  },
};

export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function unitOrThrow(id: string) {
  const u = await one('select * from units where id = $1', [id]);
  if (!u) throw notFound('Unidade');
  return u;
}

/** status calculado (nunca inventado): online pelo último heartbeat; "recebido" pela versão reportada */
export async function screenStatus(rows: any[]) {
  const s = await snapshot();
  const now = Date.now();
  return Promise.all(rows.map(async (r) => {
    const d = await decide(r.id);
    const expected = d ? contentVersion(d) : null;
    const online = !!r.last_seen_at && now - new Date(r.last_seen_at).getTime() < s.offlineAfter * 1000;
    const first = d?.playlist?.items[0];
    const thumbKey = first ? first.thumb_key || (first.kind === 'image' ? first.key : null) : null;
    return {
      ...r,
      online,
      paired: !!r.paired,
      expected_version: expected,
      in_sync: !!expected && r.reported_version === expected,
      decision: d && {
        source: d.source, explanation: d.explanation,
        rule: d.rule && { id: d.rule.id, name: d.rule.name, priority: d.rule.priority, target_type: d.rule.target_type },
        playlist: d.playlist && { id: d.playlist.id, name: d.playlist.name, version: d.playlist.version, first: first ? { name: first.name, kind: first.kind, thumb_url: thumbKey ? await signedUrl(thumbKey) : null } : null, count: d.playlist.items.length },
      },
    };
  }));
}

const SCREEN_SELECT = `
  select s.id, s.name, s.unit_id, u.name as unit_name, s.environment_id, e.name as environment_name, s.manufacturer, s.model,
         s.orientation, s.active, s.created_at, s.last_seen_at, s.last_sync_at, s.user_agent, s.capabilities, s.reported_version,
         s.playback_state, s.current_item, s.last_error, s.last_error_at, s.last_ip,
         exists(select 1 from device_credentials d where d.screen_id = s.id and d.revoked_at is null) as paired,
         coalesce(array(select group_id from screen_group_members m where m.screen_id = s.id), '{}') as group_ids
    from screens s join units u on u.id = s.unit_id left join environments e on e.id = s.environment_id`;

export async function screensVisibleTo(u: User, unitId?: string) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (!seesAllUnits(u)) { params.push(u.unit_ids); where.push(`s.unit_id = any($${params.length})`); }
  if (unitId) { params.push(unitId); where.push(`s.unit_id = $${params.length}`); }
  return q(`${SCREEN_SELECT} ${where.length ? 'where ' + where.join(' and ') : ''} order by u.name, e.sort_order nulls last, s.name`, params);
}

async function deleteRulesFor(targetType: string, id: string, c: any) {
  await q('delete from schedules where target_type = $1 and target_id = $2', [targetType, id], c);
}

export default async function orgRoutes(app: FastifyInstance) {
  // ---------------- Organização ----------------
  app.get('/api/org', async () => one('select * from organizations where id = 1'));
  app.patch<{ Body: { name?: string; fallback_playlist_id?: string | null; offline_after_seconds?: number } }>('/api/org', {
    schema: { body: { type: 'object', additionalProperties: false, properties: { name: str(120), fallback_playlist_id: { anyOf: [{ type: 'null' }, uuid] }, offline_after_seconds: { type: 'integer', minimum: 30, maximum: 3600 } } } },
  }, async (req) => {
    const me = user(req); assertAdmin(me);
    const b = req.body;
    await q(`update organizations set name = coalesce($1, name), offline_after_seconds = coalesce($2, offline_after_seconds),
             fallback_playlist_id = case when $3::boolean then $4::uuid else fallback_playlist_id end where id = 1`,
    [b.name ?? null, b.offline_after_seconds ?? null, 'fallback_playlist_id' in b, b.fallback_playlist_id ?? null]);
    await audit(me, 'editar', 'configuração', '1', 'Alterou configurações gerais', b);
    return one('select * from organizations where id = 1');
  });

  // ---------------- Unidades ----------------
  app.get<{ Querystring: { archived?: string } }>('/api/units', async (req) => {
    const u = user(req);
    const rows = await q(`
      select un.*, (select count(*)::int from screens s where s.unit_id = un.id) as screen_count,
             (select count(*)::int from environments e where e.unit_id = un.id and e.archived_at is null) as environment_count
        from units un
       where ($1::boolean or un.archived_at is null)
       order by un.archived_at nulls first, un.name`, [req.query.archived === '1']);
    const visible = rows.filter((r) => canAccessUnit(u, r.id));
    const imgs = await q('select id, storage_key from media_assets where id = any($1) and storage_key is not null', [visible.map((r) => r.image_media_id).filter(Boolean)]);
    const byId = new Map(imgs.map((m) => [m.id, m.storage_key]));
    return Promise.all(visible.map(async (r) => ({ ...r, image_url: byId.get(r.image_media_id) ? await signedUrl(byId.get(r.image_media_id)) : null })));
  });

  app.get<{ Params: { id: string } }>('/api/units/:id', async (req) => {
    assertUnit(user(req), req.params.id);
    return unitOrThrow(req.params.id);
  });

  app.post<{ Body: Record<string, any> }>('/api/units', { schema: { body: { ...unitBody, required: ['name'] } } }, async (req) => {
    const me = user(req); assertAdmin(me);
    const b = req.body;
    if (b.timezone && !isValidTimeZone(b.timezone)) throw bad('Fuso horário inválido.');
    const cols = unitFields.filter((f) => f in b);
    const r = await one(`insert into units(${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, cols.map((c) => b[c]));
    await audit(me, 'criar', 'unidade', r.id, `Criou a unidade ${r.name}`);
    return r;
  });

  app.patch<{ Params: { id: string }; Body: Record<string, any> }>('/api/units/:id', { schema: { body: unitBody } }, async (req) => {
    const me = user(req); assertAdmin(me);
    const b = req.body;
    if (b.timezone && !isValidTimeZone(b.timezone)) throw bad('Fuso horário inválido.');
    await unitOrThrow(req.params.id);
    const cols = unitFields.filter((f) => f in b);
    if (cols.length) await q(`update units set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [req.params.id, ...cols.map((c) => b[c])]);
    const r = await unitOrThrow(req.params.id);
    await audit(me, 'editar', 'unidade', r.id, `Editou a unidade ${r.name}`, b);
    return r;
  });

  for (const action of ['archive', 'unarchive'] as const) {
    app.post<{ Params: { id: string } }>(`/api/units/:id/${action}`, async (req) => {
      const me = user(req); assertAdmin(me);
      const u = await unitOrThrow(req.params.id);
      await q(`update units set archived_at = ${action === 'archive' ? 'now()' : 'null'}, updated_at = now() where id = $1`, [u.id]);
      await audit(me, action === 'archive' ? 'arquivar' : 'reativar', 'unidade', u.id, `${action === 'archive' ? 'Arquivou' : 'Desarquivou'} a unidade ${u.name}`);
      return { ok: true };
    });
  }

  app.post<{ Params: { id: string }; Body: { name: string; copy_environments?: boolean; copy_schedules?: boolean; copy_playlists?: boolean } }>('/api/units/:id/duplicate', {
    schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, copy_environments: { type: 'boolean' }, copy_schedules: { type: 'boolean' }, copy_playlists: { type: 'boolean' } } } },
  }, async (req) => {
    const me = user(req); assertAdmin(me);
    const src = await unitOrThrow(req.params.id);
    const b = req.body;
    const created = await tx(async (c) => {
      const u = await one(`insert into units(name, city, state, timezone, active) values ($1,$2,$3,$4,true) returning *`, [b.name.trim(), src.city, src.state, src.timezone], c);
      if (b.copy_environments !== false)
        await q(`insert into environments(unit_id, name, sort_order) select $1, name, sort_order from environments where unit_id = $2 and archived_at is null`, [u.id, src.id], c);
      if (b.copy_schedules) {
        const rules = await q(`select * from schedules where target_type = 'unit' and target_id = $1`, [src.id], c);
        const copied = new Map<string, string>();
        for (const r of rules) {
          let pid = r.playlist_id;
          if (b.copy_playlists) {
            if (!copied.has(pid)) {
              const p = await one(`insert into playlists(name, description, created_by) select name || ' (' || $2 || ')', description, $3 from playlists where id = $1 returning id`, [pid, u.name, me.id], c);
              await q(`insert into playlist_items(playlist_id, position, media_id, duration_ms) select $1, position, media_id, duration_ms from playlist_items where playlist_id = $2`, [p.id, pid], c);
              copied.set(pid, p.id);
            }
            pid = copied.get(pid)!;
          }
          await q(`insert into schedules(name, playlist_id, target_type, target_id, priority, start_at, end_at, time_start, time_end, weekdays, enabled, created_by)
                   values ($1,$2,'unit',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [r.name, pid, u.id, r.priority, r.start_at, r.end_at, r.time_start, r.time_end, r.weekdays, r.enabled, me.id], c);
        }
      }
      await audit(me, 'duplicar', 'unidade', u.id, `Criou a unidade ${u.name} a partir de ${src.name}`, b, c);
      return u;
    });
    return created;
  });

  // ---------------- Ambientes ----------------
  app.get<{ Params: { id: string }; Querystring: { archived?: string } }>('/api/units/:id/environments', async (req) => {
    assertUnit(user(req), req.params.id);
    return q(`select e.*, (select count(*)::int from screens s where s.environment_id = e.id) as screen_count
                from environments e where unit_id = $1 and ($2::boolean or archived_at is null) order by archived_at nulls first, sort_order, name`,
    [req.params.id, req.query.archived === '1']);
  });

  app.post<{ Params: { id: string }; Body: { name: string } }>('/api/units/:id/environments', {
    schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 } } } },
  }, async (req) => {
    const me = user(req); assertManageScreens(me, req.params.id);
    await unitOrThrow(req.params.id);
    const r = await one(`insert into environments(unit_id, name, sort_order)
                         values ($1, $2, coalesce((select max(sort_order) + 1 from environments where unit_id = $1), 1)) returning *`, [req.params.id, req.body.name.trim()]);
    await audit(me, 'criar', 'ambiente', r.id, `Criou o ambiente ${r.name}`);
    return r;
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; archived?: boolean } }>('/api/environments/:id', {
    schema: { body: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, archived: { type: 'boolean' } } } },
  }, async (req) => {
    const me = user(req);
    const e = await one('select * from environments where id = $1', [req.params.id]);
    if (!e) throw notFound('Ambiente');
    assertManageScreens(me, e.unit_id);
    const r = await one(`update environments set name = coalesce($2, name),
                           archived_at = case when $3::boolean is null then archived_at when $3 then now() else null end
                         where id = $1 returning *`, [e.id, req.body.name?.trim() ?? null, req.body.archived ?? null]);
    await audit(me, 'editar', 'ambiente', e.id, `Editou o ambiente ${r.name}`, req.body);
    return r;
  });

  app.post<{ Params: { id: string }; Body: { ids: string[] } }>('/api/units/:id/environments/reorder', {
    schema: { body: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: uuid, maxItems: 200 } } } },
  }, async (req) => {
    const me = user(req); assertManageScreens(me, req.params.id);
    await tx(async (c) => {
      for (const [i, id] of req.body.ids.entries()) await q('update environments set sort_order = $3 where id = $1 and unit_id = $2', [id, req.params.id, i + 1], c);
    });
    return { ok: true };
  });

  // ---------------- Telas ----------------
  app.get<{ Querystring: { unit_id?: string } }>('/api/screens', async (req) => screenStatus(await screensVisibleTo(user(req), req.query.unit_id)));

  app.get<{ Params: { id: string } }>('/api/screens/:id', async (req) => {
    const r = await one(`${SCREEN_SELECT} where s.id = $1`, [req.params.id]);
    if (!r) throw notFound('Tela');
    assertUnit(user(req), r.unit_id);
    return (await screenStatus([r]))[0];
  });

  app.patch<{ Params: { id: string }; Body: Record<string, any> }>('/api/screens/:id', {
    schema: { body: { type: 'object', additionalProperties: false, properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 }, manufacturer: str(80), model: str(80),
      orientation: { type: 'string', enum: ['landscape', 'portrait'] }, active: { type: 'boolean' },
      unit_id: uuid, environment_id: { anyOf: [{ type: 'null' }, uuid] }, group_ids: { type: 'array', items: uuid, maxItems: 100 },
    } } },
  }, async (req) => {
    const me = user(req);
    const s = await one('select * from screens where id = $1', [req.params.id]);
    if (!s) throw notFound('Tela');
    assertManageScreens(me, s.unit_id);
    const b = req.body;
    if (b.unit_id && b.unit_id !== s.unit_id) assertManageScreens(me, b.unit_id);
    const unitId = b.unit_id ?? s.unit_id;
    const envId = 'environment_id' in b ? b.environment_id : (unitId === s.unit_id ? s.environment_id : null);
    if (envId) {
      const e = await one('select unit_id from environments where id = $1', [envId]);
      if (!e || e.unit_id !== unitId) throw bad('O ambiente não pertence à unidade escolhida.');
    }
    await tx(async (c) => {
      await q(`update screens set name = coalesce($2, name), manufacturer = coalesce($3, manufacturer), model = coalesce($4, model),
                 orientation = coalesce($5, orientation), active = coalesce($6, active), unit_id = $7, environment_id = $8 where id = $1`,
      [s.id, b.name?.trim() ?? null, b.manufacturer ?? null, b.model ?? null, b.orientation ?? null, b.active ?? null, unitId, envId], c);
      if (unitId !== s.unit_id) // mudou de unidade: sai dos grupos da unidade antiga
        await q(`delete from screen_group_members m using screen_groups g where m.group_id = g.id and m.screen_id = $1 and g.unit_id is not null and g.unit_id <> $2`, [s.id, unitId], c);
      if (b.group_ids) await setScreenGroups(me, s.id, unitId, b.group_ids, c);
      await audit(me, 'editar', 'tela', s.id, `Editou a tela ${b.name ?? s.name}`, b, c);
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/screens/:id', async (req) => {
    const me = user(req);
    const s = await one('select * from screens where id = $1', [req.params.id]);
    if (!s) throw notFound('Tela');
    assertManageScreens(me, s.unit_id);
    await tx(async (c) => {
      await deleteRulesFor('screen', s.id, c);
      await q('delete from screens where id = $1', [s.id], c);
      await audit(me, 'remover', 'tela', s.id, `Removeu a tela ${s.name}`, undefined, c);
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/screens/:id/revoke', async (req) => {
    const me = user(req);
    const s = await one('select * from screens where id = $1', [req.params.id]);
    if (!s) throw notFound('Tela');
    assertManageScreens(me, s.unit_id);
    const r = await q('update device_credentials set revoked_at = now() where screen_id = $1 and revoked_at is null returning id', [s.id]);
    await audit(me, 'revogar', 'tela', s.id, `Revogou o acesso da tela ${s.name}`);
    return { revoked: r.length };
  });

  app.get<{ Params: { id: string } }>('/api/screens/:id/logs', async (req) => {
    const s = await one('select unit_id from screens where id = $1', [req.params.id]);
    if (!s) throw notFound('Tela');
    assertUnit(user(req), s.unit_id);
    return q('select level, message, created_at from device_logs where screen_id = $1 order by id desc limit 50', [req.params.id]);
  });

  // ---------------- Pareamento (lado do painel) ----------------
  const claimBody = {
    type: 'object', required: ['code'], additionalProperties: false,
    properties: {
      code: { type: 'string', minLength: 4, maxLength: 20 }, unit_id: uuid, environment_id: { anyOf: [{ type: 'null' }, uuid] },
      name: { type: 'string', minLength: 1, maxLength: 80 }, manufacturer: str(80), model: str(80),
      orientation: { type: 'string', enum: ['landscape', 'portrait'] }, playlist_id: { anyOf: [{ type: 'null' }, uuid] },
      group_ids: { type: 'array', items: uuid, maxItems: 100 },
    },
  };

  async function openSession(code: string, me: User, ip: string) {
    limit(`claim-user:${me.id}`, 10, 10 * 60_000);
    limit(`claim-ip:${ip}`, 30, 10 * 60_000);
    const s = await one(`select * from pairing_sessions where code = $1 and claimed_at is null and expires_at > now()`, [normalizeCode(code)]);
    if (!s) throw notFound('Código de pareamento (verifique se digitou certo ou se ele expirou)');
    return s;
  }

  app.post<{ Body: Record<string, any> }>('/api/pairing/claim', { schema: { body: claimBody } }, async (req) => {
    const me = user(req);
    const b = req.body;
    if (!b.unit_id || !b.name) throw bad('Escolha a unidade e o nome da tela.');
    assertManageScreens(me, b.unit_id);
    if (b.playlist_id) assertPublish(me, [b.unit_id]);
    const ps = await openSession(b.code, me, req.ip);
    if (b.environment_id) {
      const e = await one('select unit_id from environments where id = $1', [b.environment_id]);
      if (!e || e.unit_id !== b.unit_id) throw bad('O ambiente não pertence à unidade escolhida.');
    }
    const screen = await tx(async (c) => {
      const s = await one(`insert into screens(unit_id, environment_id, name, manufacturer, model, orientation)
                           values ($1,$2,$3,$4,$5,$6) returning *`,
      [b.unit_id, b.environment_id ?? null, b.name.trim(), b.manufacturer ?? '', b.model ?? '', b.orientation ?? 'landscape'], c);
      const claimed = await q(`update pairing_sessions set claimed_at = now(), screen_id = $2 where id = $1 and claimed_at is null returning id`, [ps.id, s.id], c);
      if (!claimed.length) throw bad('Este código acabou de ser usado. Gere um novo na TV.');
      if (b.group_ids?.length) await setScreenGroups(me, s.id, b.unit_id, b.group_ids, c);
      if (b.playlist_id)
        await q(`insert into schedules(name, playlist_id, target_type, target_id, priority, created_by) values ($1,$2,'screen',$3,10,$4)`,
          [`Padrão — ${s.name}`, b.playlist_id, s.id, me.id], c);
      await audit(me, 'parear', 'tela', s.id, `Pareou a tela ${s.name}`, undefined, c);
      return s;
    });
    return screen;
  });

  app.post<{ Params: { id: string }; Body: { code: string } }>('/api/screens/:id/repair', {
    schema: { body: { type: 'object', required: ['code'], properties: { code: { type: 'string', minLength: 4, maxLength: 20 } } } },
  }, async (req) => {
    const me = user(req);
    const s = await one('select * from screens where id = $1', [req.params.id]);
    if (!s) throw notFound('Tela');
    assertManageScreens(me, s.unit_id);
    const ps = await openSession(req.body.code, me, req.ip);
    await tx(async (c) => {
      await q('update device_credentials set revoked_at = now() where screen_id = $1 and revoked_at is null', [s.id], c);
      const claimed = await q(`update pairing_sessions set claimed_at = now(), screen_id = $2 where id = $1 and claimed_at is null returning id`, [ps.id, s.id], c);
      if (!claimed.length) throw bad('Este código acabou de ser usado. Gere um novo na TV.');
      await audit(me, 'parear', 'tela', s.id, `Refez o pareamento da tela ${s.name}`, undefined, c);
    });
    return { ok: true };
  });

  // ---------------- Grupos ----------------
  app.get('/api/groups', async (req) => {
    const me = user(req);
    const rows = await q(`select g.*, un.name as unit_name,
                                 coalesce(array(select screen_id from screen_group_members m where m.group_id = g.id), '{}') as screen_ids,
                                 coalesce(array(select distinct s.unit_id from screen_group_members m join screens s on s.id = m.screen_id where m.group_id = g.id), '{}') as member_unit_ids
                            from screen_groups g left join units un on un.id = g.unit_id order by g.name`);
    return rows.filter((g) => g.unit_id ? canAccessUnit(me, g.unit_id) : g.member_unit_ids.every((u: string) => canAccessUnit(me, u)));
  });

  const groupBody = { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, description: str(300), unit_id: { anyOf: [{ type: 'null' }, uuid] } } };
  const assertGroup = (me: User, unitId: string | null) => unitId ? assertManageScreens(me, unitId) : assertAdmin(me);

  app.post<{ Body: { name: string; description?: string; unit_id?: string | null } }>('/api/groups', { schema: { body: { ...groupBody, required: ['name'] } } }, async (req) => {
    const me = user(req);
    assertGroup(me, req.body.unit_id ?? null);
    const g = await one('insert into screen_groups(name, description, unit_id) values ($1,$2,$3) returning *', [req.body.name.trim(), req.body.description ?? '', req.body.unit_id ?? null]);
    await audit(me, 'criar', 'grupo', g.id, `Criou o grupo ${g.name}`);
    return g;
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string } }>('/api/groups/:id', { schema: { body: groupBody } }, async (req) => {
    const me = user(req);
    const g = await one('select * from screen_groups where id = $1', [req.params.id]);
    if (!g) throw notFound('Grupo');
    assertGroup(me, g.unit_id);
    await q('update screen_groups set name = coalesce($2, name), description = coalesce($3, description) where id = $1', [g.id, req.body.name?.trim() ?? null, req.body.description ?? null]);
    await audit(me, 'editar', 'grupo', g.id, `Editou o grupo ${req.body.name ?? g.name}`);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/groups/:id', async (req) => {
    const me = user(req);
    const g = await one('select * from screen_groups where id = $1', [req.params.id]);
    if (!g) throw notFound('Grupo');
    assertGroup(me, g.unit_id);
    await tx(async (c) => {
      await deleteRulesFor('group', g.id, c);
      await q('delete from screen_groups where id = $1', [g.id], c);
      await audit(me, 'remover', 'grupo', g.id, `Removeu o grupo ${g.name}`, undefined, c);
    });
    return { ok: true };
  });

  app.put<{ Params: { id: string }; Body: { screen_ids: string[] } }>('/api/groups/:id/members', {
    schema: { body: { type: 'object', required: ['screen_ids'], properties: { screen_ids: { type: 'array', items: uuid, maxItems: 1000 } } } },
  }, async (req) => {
    const me = user(req);
    const g = await one('select * from screen_groups where id = $1', [req.params.id]);
    if (!g) throw notFound('Grupo');
    assertGroup(me, g.unit_id);
    const ids = [...new Set(req.body.screen_ids)];
    const screens = await q('select id, unit_id from screens where id = any($1)', [ids]);
    if (screens.length !== ids.length) throw bad('Alguma tela não existe.');
    if (g.unit_id && screens.some((s) => s.unit_id !== g.unit_id)) throw bad('Este grupo é da unidade e só aceita telas dela.');
    await tx(async (c) => {
      await q('delete from screen_group_members where group_id = $1', [g.id], c);
      for (const id of ids) await q('insert into screen_group_members values ($1,$2)', [g.id, id], c);
      await audit(me, 'editar', 'grupo', g.id, `Atualizou as telas do grupo ${g.name} (${ids.length})`, undefined, c);
    });
    return { ok: true };
  });
}

async function setScreenGroups(me: User, screenId: string, unitId: string, groupIds: string[], c: any) {
  const groups = groupIds.length ? await q('select id, unit_id from screen_groups where id = any($1)', [groupIds], c) : [];
  if (groups.length !== new Set(groupIds).size) throw bad('Algum grupo não existe.');
  for (const g of groups) {
    if (g.unit_id && g.unit_id !== unitId) throw bad('Um dos grupos é de outra unidade.');
    if (!g.unit_id) assertAdmin(me);
  }
  // quem não é admin não mexe em grupos entre unidades (mantém essas associações como estão)
  await q(`delete from screen_group_members m using screen_groups g
            where m.group_id = g.id and m.screen_id = $1 and ($2::boolean or g.unit_id is not null)`, [screenId, me.role === 'admin'], c);
  for (const g of groups) await q('insert into screen_group_members values ($1,$2) on conflict do nothing', [g.id, screenId], c);
}
