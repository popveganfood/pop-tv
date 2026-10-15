// Imita o R2 em desenvolvimento/testes: PUT/GET com URL assinada por HMAC e suporte a Range.
// Nunca é registrado em produção (config.ts recusa STORAGE_DRIVER=local com NODE_ENV=production).
import type { FastifyInstance } from 'fastify';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { localPath, verifyLocalSig } from '../storage.ts';
import { config } from '../config.ts';

export default async function devStorage(app: FastifyInstance) {
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

  app.put<{ Params: { '*': string }; Querystring: { e: string; s: string } }>('/api/dev-storage/*', async (req, reply) => {
    const key = req.params['*'];
    if (!verifyLocalSig('PUT', key, Number(req.query.e), req.query.s)) return reply.code(403).send({ error: 'Assinatura inválida' });
    const len = Number(req.headers['content-length'] || 0);
    if (len > config.maxVideoBytes) return reply.code(413).send({ error: 'Arquivo grande demais' });
    await mkdir(dirname(localPath(key)), { recursive: true });
    let total = 0;
    const { Transform } = await import('node:stream');
    const counter = new Transform({ transform(chunk, _e, cb) { total += chunk.length; cb(total > config.maxVideoBytes ? new Error('grande demais') : null, chunk); } });
    try { await pipeline(req.body as NodeJS.ReadableStream, counter, createWriteStream(localPath(key))); }
    catch { return reply.code(413).send({ error: 'Arquivo grande demais' }); }
    return reply.code(200).send();
  });

  app.get<{ Params: { '*': string }; Querystring: { e: string; s: string } }>('/api/dev-storage/*', async (req, reply) => {
    const key = req.params['*'];
    if (!verifyLocalSig('GET', key, Number(req.query.e), req.query.s)) return reply.code(403).send({ error: 'Assinatura inválida' });
    let size: number;
    try { size = (await stat(localPath(key))).size; } catch { return reply.code(404).send({ error: 'Não encontrado' }); }
    reply.header('Accept-Ranges', 'bytes').header('Access-Control-Allow-Origin', '*');
    const ext = key.split('.').pop();
    reply.type({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4' }[ext!] || 'application/octet-stream');
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m) {
      const start = m[1] ? Number(m[1]) : size - Number(m[2]);
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end || start >= size) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1);
      return reply.send(createReadStream(localPath(key), { start, end }));
    }
    reply.header('Content-Length', size);
    return reply.send(createReadStream(localPath(key)));
  });
}
