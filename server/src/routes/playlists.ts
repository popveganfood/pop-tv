import type { FastifyInstance } from 'fastify';
import { q, one, tx, type Db } from '../db.ts';
import { user, assertContent, assertPublish, bad, notFound, HttpError, type User } from '../auth.ts';
import { audit } from '../audit.ts';
import { signedUrl, type VersionItem } from '../resolver.ts';

const uuid = { type: 'string', format: 'uuid' };

/** unidades atingidas por uma playlist (via regras e playlist de segurança) — para checar permissão */
export async function unitsReachedByPlaylist(playlistId: string, db?: Db) {
  const fb = await one('select 1 from organizations where fallback_playlist_id = $1', [playlistId], db);
  const rules = await q('select target_type, target_id from schedules where playlist_id = $1', [playlistId], db);
  let all = !!fb || rules.some((r) => r.target_type === 'all');
  for (const r of rules) if (r.target_type === 'group' && (await one('select 1 from screen_groups where id = $1 and unit_id is null', [r.target_id], db))) all = true;
  const units = new Set<string>();
  for (const r of rules) {
    if (r.target_type === 'unit') units.add(r.target_id);
    if (r.target_type === 'screen' || r.target_type === 'group') {
      const rows = r.target_type === 'screen'
        ? await q('select unit_id from screens where id = $1', [r.target_id], db)
        : await q('select distinct s.unit_id from screen_group_members m join screens s on s.id = m.screen_id where m.group_id = $1', [r.target_id], db);
      rows.forEach((x) => units.add(x.unit_id));
    }
  }
  return { all, units: [...units] };
}

async function assertCanPublishPlaylist(me: User, playlistId: string) {
  assertContent(me);
  const reach = await unitsReachedByPlaylist(playlistId);
  assertPublish(me, reach.units, reach.all);
}

async function draftItems(playlistId: string) {
  const rows = await q(`select pi.id, pi.position, pi.duration_ms, m.id as media_id, m.name, m.kind, m.mime, m.storage_key, m.thumb_key,
                               m.width, m.height, m.duration_ms as media_duration_ms, m.compat, m.compat_notes, m.deleted_at, m.status
                          from playlist_items pi join media_assets m on m.id = pi.media_id
                         where pi.playlist_id = $1 order by pi.position`, [playlistId]);
  return Promise.all(rows.map(async (r) => ({
    ...r,
    url: r.storage_key ? await signedUrl(r.storage_key) : null,
    thumb_url: r.thumb_key ? await signedUrl(r.thumb_key) : r.kind === 'image' && r.storage_key ? await signedUrl(r.storage_key) : null,
  })));
}

export default async function playlistRoutes(app: FastifyInstance) {
  app.get('/api/playlists', async () => {
    const rows = await q(`
      select p.id, p.name, p.description, p.created_at, p.draft_updated_at, p.published_version_id,
             v.version as published_version, v.created_at as published_at,
             (v.id is null or p.draft_updated_at > v.created_at) as has_unpublished_changes,
             (select count(*)::int from playlist_items pi where pi.playlist_id = p.id) as item_count,
             (select count(*)::int from schedules s where s.playlist_id = p.id) as schedule_count,
             (select coalesce(sum(coalesce(pi.duration_ms, case when m.kind = 'image' then 10000 else m.duration_ms end)), 0)::int
                from playlist_items pi join media_assets m on m.id = pi.media_id where pi.playlist_id = p.id) as total_ms,
             (select m.id from playlist_items pi join media_assets m on m.id = pi.media_id where pi.playlist_id = p.id order by pi.position limit 1) as cover_media_id,
             (o.fallback_playlist_id = p.id) as is_fallback
        from playlists p left join published_versions v on v.id = p.published_version_id
        cross join organizations o
       where p.archived_at is null order by is_fallback desc, p.name`);
    const covers = await q(`select id, kind, storage_key, thumb_key from media_assets where id = any($1)`, [rows.map((r) => r.cover_media_id).filter(Boolean)]);
    const byId = new Map(covers.map((c) => [c.id, c]));
    return Promise.all(rows.map(async (r) => {
      const c = byId.get(r.cover_media_id);
      const k = c?.thumb_key ?? (c?.kind === 'image' ? c.storage_key : null);
      return { ...r, cover_url: k ? await signedUrl(k) : null };
    }));
  });

  app.post<{ Body: { name: string; description?: string } }>('/api/playlists', {
    schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 500 } } } },
  }, async (req) => {
    const me = user(req); assertContent(me);
    const p = await one('insert into playlists(name, description, created_by) values ($1,$2,$3) returning *', [req.body.name.trim(), req.body.description ?? '', me.id]);
    await audit(me, 'criar', 'playlist', p.id, `Criou a playlist ${p.name}`);
    return p;
  });

  app.get<{ Params: { id: string } }>('/api/playlists/:id', async (req) => {
    const p = await one(`select p.*, v.version as published_version, v.created_at as published_at,
                                (v.id is null or p.draft_updated_at > v.created_at) as has_unpublished_changes,
                                (select fallback_playlist_id from organizations) = p.id as is_fallback
                           from playlists p left join published_versions v on v.id = p.published_version_id where p.id = $1`, [req.params.id]);
    if (!p) throw notFound('Playlist');
    const schedules = await q('select id, name, target_type, target_id, priority, enabled from schedules where playlist_id = $1 order by priority desc, name', [p.id]);
    return { ...p, items: await draftItems(p.id), schedules };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string } }>('/api/playlists/:id', {
    schema: { body: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 500 } } } },
  }, async (req) => {
    const me = user(req); assertContent(me);
    const p = await one('update playlists set name = coalesce($2, name), description = coalesce($3, description) where id = $1 returning *', [req.params.id, req.body.name?.trim() ?? null, req.body.description ?? null]);
    if (!p) throw notFound('Playlist');
    await audit(me, 'editar', 'playlist', p.id, `Editou a playlist ${p.name}`);
    return p;
  });

  app.delete<{ Params: { id: string } }>('/api/playlists/:id', async (req) => {
    const me = user(req); assertContent(me);
    const p = await one('select * from playlists where id = $1', [req.params.id]);
    if (!p) throw notFound('Playlist');
    if (await one('select 1 from organizations where fallback_playlist_id = $1', [p.id])) throw bad('Esta é a playlist de segurança. Escolha outra em Configurações antes de excluir.');
    const rules = await q('select name from schedules where playlist_id = $1', [p.id]);
    if (rules.length) throw new HttpError(409, `A playlist é usada em ${rules.length} programação(ões): ${rules.map((r) => r.name).join(', ')}. Remova-as antes.`);
    await tx(async (c) => {
      await q('update playlists set published_version_id = null where id = $1', [p.id], c);
      await q('delete from playlists where id = $1', [p.id], c);
      await audit(me, 'excluir', 'playlist', p.id, `Excluiu a playlist ${p.name}`, undefined, c);
    });
    return { ok: true };
  });

  // salvar rascunho
  app.put<{ Params: { id: string }; Body: { items: { media_id: string; duration_ms?: number | null }[] } }>('/api/playlists/:id/items', {
    schema: { body: { type: 'object', required: ['items'], properties: { items: { type: 'array', maxItems: 300, items: {
      type: 'object', required: ['media_id'], properties: { media_id: uuid, duration_ms: { anyOf: [{ type: 'null' }, { type: 'integer', minimum: 1000, maximum: 3600000 }] } },
    } } } } },
  }, async (req) => {
    const me = user(req); assertContent(me);
    const p = await one('select * from playlists where id = $1', [req.params.id]);
    if (!p) throw notFound('Playlist');
    const ids = [...new Set(req.body.items.map((i) => i.media_id))];
    const ok = await q(`select id from media_assets where id = any($1) and status = 'ready' and deleted_at is null`, [ids]);
    if (ok.length !== ids.length) throw bad('Algum arquivo da playlist não existe mais ou ainda está sendo enviado.');
    await tx(async (c) => {
      await q('delete from playlist_items where playlist_id = $1', [p.id], c);
      for (const [i, it] of req.body.items.entries())
        await q('insert into playlist_items(playlist_id, position, media_id, duration_ms) values ($1,$2,$3,$4)', [p.id, i + 1, it.media_id, it.duration_ms ?? null], c);
      await q('update playlists set draft_updated_at = now() where id = $1', [p.id], c);
      await audit(me, 'editar', 'playlist', p.id, `Salvou o rascunho da playlist ${p.name} (${req.body.items.length} itens)`, undefined, c);
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/playlists/:id/duplicate', async (req) => {
    const me = user(req); assertContent(me);
    const p = await tx(async (c) => {
      const n = await one(`insert into playlists(name, description, created_by) select name || ' (cópia)', description, $2 from playlists where id = $1 returning *`, [req.params.id, me.id], c);
      if (!n) throw notFound('Playlist');
      await q('insert into playlist_items(playlist_id, position, media_id, duration_ms) select $1, position, media_id, duration_ms from playlist_items where playlist_id = $2', [n.id, req.params.id], c);
      await audit(me, 'duplicar', 'playlist', n.id, `Criou ${n.name}`, undefined, c);
      return n;
    });
    return p;
  });

  async function publishItems(me: User, playlistId: string, items: VersionItem[], note: string) {
    if (!items.length) throw bad('A playlist está vazia. Adicione ao menos um arquivo antes de publicar.');
    return tx(async (c) => {
      await q('select id from playlists where id = $1 for update', [playlistId], c);
      const v = await one(`insert into published_versions(playlist_id, version, items, note, created_by)
                           values ($1, coalesce((select max(version) from published_versions where playlist_id = $1), 0) + 1, $2, $3, $4) returning *`,
      [playlistId, JSON.stringify(items), note, me.id], c);
      await q('update playlists set published_version_id = $2, draft_updated_at = least(draft_updated_at, now()) where id = $1', [playlistId, v.id], c);
      return v;
    });
  }

  app.post<{ Params: { id: string }; Body: { note?: string } }>('/api/playlists/:id/publish', {
    schema: { body: { type: 'object', properties: { note: { type: 'string', maxLength: 300 } } } },
  }, async (req) => {
    const me = user(req);
    const p = await one('select * from playlists where id = $1', [req.params.id]);
    if (!p) throw notFound('Playlist');
    await assertCanPublishPlaylist(me, p.id);
    const rows = await q(`select m.id, m.name, m.kind, m.mime, m.storage_key, m.thumb_key, m.width, m.height, m.status, m.deleted_at, pi.duration_ms, m.duration_ms as media_duration_ms
                            from playlist_items pi join media_assets m on m.id = pi.media_id where pi.playlist_id = $1 order by pi.position`, [p.id]);
    if (rows.some((r) => r.status !== 'ready' || r.deleted_at || !r.storage_key)) throw bad('Há arquivos inválidos na playlist. Remova-os antes de publicar.');
    const items: VersionItem[] = rows.map((r) => ({
      media_id: r.id, key: r.storage_key, kind: r.kind, mime: r.mime, name: r.name,
      // vídeo: guarda a duração real só para exibição (a TV sempre toca o vídeo até o fim)
      duration_ms: r.kind === 'image' ? r.duration_ms ?? 10_000 : r.media_duration_ms, width: r.width, height: r.height, thumb_key: r.thumb_key,
    }));
    const v = await publishItems(me, p.id, items, req.body?.note ?? '');
    await audit(me, 'publicar', 'playlist', p.id, `Publicou a playlist ${p.name} (versão ${v.version})`);
    return { version: v.version, id: v.id };
  });

  app.get<{ Params: { id: string } }>('/api/playlists/:id/versions', async (req) =>
    q(`select v.id, v.version, v.note, v.created_at, jsonb_array_length(v.items) as item_count, u.name as created_by_name,
              (p.published_version_id = v.id) as current
         from published_versions v join playlists p on p.id = v.playlist_id left join users u on u.id = v.created_by
        where v.playlist_id = $1 order by v.version desc`, [req.params.id]));

  app.post<{ Params: { id: string; versionId: string } }>('/api/playlists/:id/versions/:versionId/restore', async (req) => {
    const me = user(req);
    const old = await one('select * from published_versions where id = $1 and playlist_id = $2', [req.params.versionId, req.params.id]);
    if (!old) throw notFound('Versão');
    await assertCanPublishPlaylist(me, req.params.id);
    const v = await publishItems(me, req.params.id, old.items, `Restauração da versão ${old.version}`);
    // rascunho passa a refletir a versão restaurada (sem arquivos que foram excluídos)
    await tx(async (c) => {
      await q('delete from playlist_items where playlist_id = $1', [req.params.id], c);
      let pos = 1;
      for (const it of old.items as VersionItem[]) {
        const alive = await one('select 1 from media_assets where id = $1 and deleted_at is null', [it.media_id], c);
        if (alive) await q('insert into playlist_items(playlist_id, position, media_id, duration_ms) values ($1,$2,$3,$4)', [req.params.id, pos++, it.media_id, it.kind === 'image' ? it.duration_ms : null], c);
      }
      await q('update playlists set draft_updated_at = (select created_at from published_versions where id = $2) where id = $1', [req.params.id, v.id], c);
    });
    await audit(me, 'restaurar', 'playlist', req.params.id, `Restaurou a versão ${old.version} (nova versão ${v.version})`);
    return { version: v.version };
  });
}
