import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { q, one } from '../db.ts';
import { config } from '../config.ts';
import { user, assertContent, bad, notFound, HttpError } from '../auth.ts';
import { audit } from '../audit.ts';
import { storage } from '../storage.ts';
import { inspect, INSPECT_BYTES } from '../inspect.ts';
import { signedUrl } from '../resolver.ts';

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };
const uuid = { type: 'string', format: 'uuid' };

// o navegador envia para uma chave de "rascunho"; só depois da conferência o servidor copia para a
// chave final. Assim a URL de envio (válida por 15 min) não consegue trocar um arquivo já conferido.
const newKey = (id: string, mime: string) => `uploads/${id}/${randomBytes(8).toString('hex')}.${MIME_EXT[mime]}`;
const finalKey = (staging: string) => staging.replace(/^uploads\//, 'media/');

function checkDeclared(mime: string, size: number) {
  if (!MIME_EXT[mime]) throw bad('Formato não aceito. Envie JPG, PNG, WebP ou MP4.');
  const max = mime.startsWith('video/') ? config.maxVideoBytes : config.maxImageBytes;
  if (size > max) throw bad(`Arquivo acima do limite de ${Math.round(max / 1048576)} MB.`);
}

async function withUrls(rows: any[]) {
  return Promise.all(rows.map(async (r) => ({
    ...r,
    url: r.storage_key ? await signedUrl(r.storage_key) : null,
    thumb_url: r.thumb_key ? await signedUrl(r.thumb_key) : r.kind === 'image' && r.storage_key ? await signedUrl(r.storage_key) : null,
  })));
}

const SELECT = `select m.*, c.name as collection_name,
  (select count(distinct pi.playlist_id)::int from playlist_items pi where pi.media_id = m.id) as used_in
  from media_assets m left join collections c on c.id = m.collection_id`;

export default async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; kind?: string; collection_id?: string; tag?: string } }>('/api/media', async (req) => {
    const { q: text, kind, collection_id, tag } = req.query;
    const p: unknown[] = [];
    const w = ['m.deleted_at is null', `m.status = 'ready'`];
    if (text) { p.push(`%${text}%`); w.push(`(m.name ilike $${p.length} or array_to_string(m.tags, ' ') ilike $${p.length})`); }
    if (kind === 'image' || kind === 'video') { p.push(kind); w.push(`m.kind = $${p.length}`); }
    if (collection_id) { p.push(collection_id); w.push(`m.collection_id = $${p.length}`); }
    if (tag) { p.push(tag); w.push(`$${p.length} = any(m.tags)`); }
    return withUrls(await q(`${SELECT} where ${w.join(' and ')} order by m.created_at desc limit 500`, p));
  });

  app.get<{ Params: { id: string } }>('/api/media/:id', async (req) => {
    const r = await one(`${SELECT} where m.id = $1 and m.deleted_at is null`, [req.params.id]);
    if (!r) throw notFound('Arquivo');
    return (await withUrls([r]))[0];
  });

  // 1) pedir URL de upload (o arquivo vai direto do navegador para o R2)
  app.post<{ Body: { name: string; mime: string; size: number; collection_id?: string | null; tags?: string[] } }>('/api/media/uploads', {
    schema: { body: { type: 'object', required: ['name', 'mime', 'size'], properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 }, mime: { type: 'string', maxLength: 60 }, size: { type: 'integer', minimum: 1 },
      collection_id: { anyOf: [{ type: 'null' }, uuid] }, tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 30 },
    } } },
  }, async (req) => {
    const me = user(req); assertContent(me);
    const b = req.body;
    checkDeclared(b.mime, b.size);
    const a = await one(`insert into media_assets(name, collection_id, tags, created_by) values ($1,$2,$3,$4) returning id`,
      [b.name.replace(/\.[a-z0-9]{2,4}$/i, '').trim() || 'Sem nome', b.collection_id ?? null, b.tags ?? [], me.id]);
    const key = newKey(a.id, b.mime);
    await q('update media_assets set pending_key = $2, pending_mime = $3 where id = $1', [a.id, key, b.mime]);
    return { id: a.id, upload: { ...(await storage.presignPut(key)), headers: { 'Content-Type': b.mime } } };
  });

  // substituir o arquivo mantendo nome, etiquetas e uso nas playlists
  app.post<{ Params: { id: string }; Body: { mime: string; size: number } }>('/api/media/:id/replace', {
    schema: { body: { type: 'object', required: ['mime', 'size'], properties: { mime: { type: 'string' }, size: { type: 'integer', minimum: 1 } } } },
  }, async (req) => {
    const me = user(req); assertContent(me);
    const a = await one('select * from media_assets where id = $1 and deleted_at is null', [req.params.id]);
    if (!a) throw notFound('Arquivo');
    checkDeclared(req.body.mime, req.body.size);
    const key = newKey(a.id, req.body.mime);
    await q('update media_assets set pending_key = $2, pending_mime = $3 where id = $1', [a.id, key, req.body.mime]);
    return { id: a.id, upload: { ...(await storage.presignPut(key)), headers: { 'Content-Type': req.body.mime } } };
  });

  // 2) avisar que o upload terminou: o servidor confere o arquivo de verdade
  app.post<{ Params: { id: string } }>('/api/media/:id/complete', async (req) => {
    const me = user(req); assertContent(me);
    const a = await one('select * from media_assets where id = $1 and deleted_at is null', [req.params.id]);
    if (!a || !a.pending_key) throw notFound('Upload pendente');
    const key = a.pending_key as string;
    const size = await storage.size(key);
    if (!size) throw bad('O arquivo não chegou ao armazenamento. Tente enviar de novo.');
    const head = await storage.readRange(key, 0, Math.min(size, INSPECT_BYTES) - 1);
    const tail = size > INSPECT_BYTES ? await storage.readRange(key, Math.max(INSPECT_BYTES, size - INSPECT_BYTES), size - 1) : head;
    const info = inspect(head, tail, size, { image: config.maxImageBytes, video: config.maxVideoBytes });
    const isNew = !a.storage_key;
    if (info.ok && !(!isNew && a.kind !== info.kind)) {
      const dest = finalKey(key);
      await storage.copy(key, dest);
      await storage.remove(key);
      Object.assign(a, { final_key: dest });
    }
    if (!info.ok) {
      await storage.remove(key);
      if (isNew) await q('delete from media_assets where id = $1', [a.id]);
      else await q('update media_assets set pending_key = null, pending_mime = null where id = $1', [a.id]);
      throw new HttpError(422, info.error!);
    }
    if (!isNew && a.kind !== info.kind) {
      await storage.remove(key);
      await q('update media_assets set pending_key = null where id = $1', [a.id]);
      throw bad(a.kind === 'image' ? 'Substitua uma imagem por outra imagem.' : 'Substitua um vídeo por outro vídeo.');
    }
    // ponytail: o arquivo antigo de uma substituição fica no R2 porque versões publicadas apontam
    // para ele (restauração). Limpeza de órfãos = tarefa futura.
    const stored = a.final_key as string;
    await q(`update media_assets set storage_key = $2, pending_key = null, pending_mime = null, kind = $3, mime = $4, size_bytes = $5,
               width = $6, height = $7, duration_ms = $8, codec = $9, compat = $10, compat_notes = $11, status = 'ready',
               thumb_key = case when $3 = 'image' then null else thumb_key end,
               file_version = file_version + 1, updated_at = now() where id = $1`,
    [a.id, stored, info.kind, info.mime, size, info.width ?? null, info.height ?? null, info.duration_ms ?? null, info.codec ?? null, info.compat, info.notes.join(' ')]);
    if (!isNew) await q('update playlists set draft_updated_at = now() where id in (select playlist_id from playlist_items where media_id = $1)', [a.id]);
    await audit(me, isNew ? 'enviar' : 'substituir', 'mídia', a.id, `${isNew ? 'Enviou' : 'Substituiu'} o arquivo ${a.name}`);
    return (await withUrls([await one(`${SELECT} where m.id = $1`, [a.id])]))[0];
  });

  // miniatura de vídeo (gerada no navegador a partir de um quadro do vídeo)
  app.post<{ Params: { id: string }; Body: { size: number } }>('/api/media/:id/thumbnail', {
    schema: { body: { type: 'object', required: ['size'], properties: { size: { type: 'integer', minimum: 1, maximum: 2 * 1048576 } } } },
  }, async (req) => {
    assertContent(user(req));
    const a = await one('select id from media_assets where id = $1', [req.params.id]);
    if (!a) throw notFound('Arquivo');
    const key = `uploads/${a.id}/thumb-${randomBytes(6).toString('hex')}.jpg`;
    const up = await storage.presignPut(key);
    return { key, upload: { ...up, headers: { 'Content-Type': 'image/jpeg' } } };
  });
  app.post<{ Params: { id: string }; Body: { key: string } }>('/api/media/:id/thumbnail/complete', {
    schema: { body: { type: 'object', required: ['key'], properties: { key: { type: 'string', maxLength: 200 } } } },
  }, async (req) => {
    assertContent(user(req));
    const { key } = req.body;
    if (!/^uploads\/[0-9a-f-]+\/thumb-[0-9a-f]+\.jpg$/.test(key) || !key.startsWith(`uploads/${req.params.id}/`)) throw bad('Chave inválida.');
    const size = await storage.size(key);
    if (!size) throw bad('Miniatura não encontrada.');
    const head = await storage.readRange(key, 0, Math.min(size, 64) - 1);
    if (!(head[0] === 0xff && head[1] === 0xd8)) { await storage.remove(key); throw bad('Miniatura inválida.'); }
    const dest = finalKey(key);
    await storage.copy(key, dest);
    await storage.remove(key);
    await q('update media_assets set thumb_key = $2 where id = $1', [req.params.id, dest]);
    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; tags?: string[]; collection_id?: string | null } }>('/api/media/:id', {
    schema: { body: { type: 'object', additionalProperties: false, properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 }, tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 30 },
      collection_id: { anyOf: [{ type: 'null' }, uuid] },
    } } },
  }, async (req) => {
    const me = user(req); assertContent(me);
    const b = req.body;
    const r = await one(`update media_assets set name = coalesce($2, name), tags = coalesce($3, tags),
                           collection_id = case when $4::boolean then $5::uuid else collection_id end, updated_at = now()
                         where id = $1 and deleted_at is null returning id, name`,
    [req.params.id, b.name?.trim() ?? null, b.tags ? [...new Set(b.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))] : null, 'collection_id' in b, b.collection_id ?? null]);
    if (!r) throw notFound('Arquivo');
    await audit(me, 'editar', 'mídia', r.id, `Editou o arquivo ${r.name}`, b);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/media/:id/usage', async (req) => usage(req.params.id));

  app.delete<{ Params: { id: string } }>('/api/media/:id', async (req) => {
    const me = user(req); assertContent(me);
    const a = await one('select * from media_assets where id = $1 and deleted_at is null', [req.params.id]);
    if (!a) throw notFound('Arquivo');
    const u = await usage(a.id);
    if (u.playlists.length || u.units.length)
      throw new HttpError(409, 'Este arquivo está em uso e não pode ser excluído. Remova-o das playlists primeiro.', { usage: u });
    // exclusão lógica: versões publicadas antigas ainda podem apontar para o arquivo
    await q('update media_assets set deleted_at = now() where id = $1', [a.id]);
    await audit(me, 'excluir', 'mídia', a.id, `Excluiu o arquivo ${a.name}`);
    return { ok: true };
  });

  // ---------------- Coleções ----------------
  app.get('/api/collections', async () =>
    q(`select c.*, (select count(*)::int from media_assets m where m.collection_id = c.id and m.deleted_at is null and m.status = 'ready') as media_count
         from collections c order by sort_order, name`));
  const colBody = { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 60 } } };
  app.post<{ Body: { name: string } }>('/api/collections', { schema: { body: colBody } }, async (req) => {
    const me = user(req); assertContent(me);
    const c = await one(`insert into collections(name, sort_order) values ($1, coalesce((select max(sort_order)+1 from collections), 1)) returning *`, [req.body.name.trim()]);
    await audit(me, 'criar', 'coleção', c.id, `Criou a coleção ${c.name}`);
    return c;
  });
  app.patch<{ Params: { id: string }; Body: { name: string } }>('/api/collections/:id', { schema: { body: colBody } }, async (req) => {
    const me = user(req); assertContent(me);
    const c = await one('update collections set name = $2 where id = $1 returning *', [req.params.id, req.body.name.trim()]);
    if (!c) throw notFound('Coleção');
    await audit(me, 'editar', 'coleção', c.id, `Renomeou a coleção para ${c.name}`);
    return c;
  });
  app.delete<{ Params: { id: string } }>('/api/collections/:id', async (req) => {
    const me = user(req); assertContent(me);
    const c = await one('delete from collections where id = $1 returning name', [req.params.id]);
    if (!c) throw notFound('Coleção');
    await audit(me, 'remover', 'coleção', req.params.id, `Removeu a coleção ${c.name} (os arquivos continuam na biblioteca)`);
    return { ok: true };
  });
}

export async function usage(mediaId: string) {
  // rascunhos que usam o arquivo + versões publicadas EM VIGOR que ainda o exibem
  const playlists = await q(`select p.id, p.name, (p.published_version_id is not null) as published
                               from playlists p
                              where exists (select 1 from playlist_items pi where pi.playlist_id = p.id and pi.media_id = $1)
                                 or exists (select 1 from published_versions v where v.id = p.published_version_id
                                             and v.items @> jsonb_build_array(jsonb_build_object('media_id', $1::text)))
                              order by p.name`, [mediaId]);
  const units = await q('select id, name from units where image_media_id = $1', [mediaId]);
  return { playlists, units };
}
