import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { HttpError, requireUser } from './auth.ts';
import { invalidate } from './resolver.ts';
import authRoutes from './routes/auth.ts';
import orgRoutes from './routes/org.ts';
import mediaRoutes from './routes/media.ts';
import playlistRoutes from './routes/playlists.ts';
import scheduleRoutes from './routes/schedules.ts';
import dashboardRoutes from './routes/dashboard.ts';
import playerRoutes from './routes/player.ts';
import devStorage from './routes/devstorage.ts';

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? { level: config.isProd ? 'info' : 'warn' },
    trustProxy: (_addr: string, hop: number) => hop === 0, // confia só no proxy do Railway (1 salto): X-Forwarded-For forjado não burla o rate limit
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, ...err.extra });
    if ((err as FastifyError).validation) return reply.code(400).send({ error: 'Dados inválidos: ' + err.message });
    const pg = err as unknown as { code?: string; constraint?: string };
    if (pg.code === '23503') return reply.code(409).send({ error: 'Este registro está em uso por outro item e não pode ser removido/alterado.' });
    if (pg.code === '23505') return reply.code(409).send({ error: 'Já existe um registro com esses dados.' });
    if (pg.code === '23514' || pg.code === '22P02' || pg.code === '22007' || pg.code === '22008') return reply.code(400).send({ error: 'Dados inválidos.' });
    if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) return reply.code((err as FastifyError).statusCode!).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Erro interno. Tente novamente; se persistir, avise o administrador.' });
  });

  // Segurança básica de cabeçalhos
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (!req.url.startsWith('/tv')) reply.header('X-Frame-Options', 'DENY');
  });

  // CSRF: mutações administrativas só com JSON (formulários de outros sites não conseguem enviar JSON
  // sem preflight CORS, que este servidor não autoriza) + cookie SameSite=Lax.
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/dev-storage/')) return;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const ct = String(req.headers['content-type'] || '');
      if (!ct.startsWith('application/json')) throw new HttpError(415, 'Envie os dados como JSON.');
    }
  });

  // Qualquer alteração bem-sucedida invalida o snapshot de programação.
  app.addHook('onResponse', async (req, reply) => {
    if (req.method !== 'GET' && req.url.startsWith('/api/') && !req.url.startsWith('/api/player/') && reply.statusCode < 400) invalidate();
  });

  // Aceitar corpo vazio com content-type JSON (ex.: POST de ação sem dados)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, body === '' ? {} : JSON.parse(body as string)); }
    catch { done(new HttpError(400, 'JSON inválido.'), undefined); }
  });

  await app.register(playerRoutes);
  await app.register(authRoutes);
  await app.register(async (admin) => {
    admin.addHook('preHandler', requireUser);
    await admin.register(orgRoutes);
    await admin.register(mediaRoutes);
    await admin.register(playlistRoutes);
    await admin.register(scheduleRoutes);
    await admin.register(dashboardRoutes);
  });
  if (config.storageDriver === 'local') await app.register(devStorage);

  app.get('/api/health', async () => ({ ok: true }));

  // Player das TVs (estático, sem build) e painel (build do Vite)
  await app.register(fastifyStatic, {
    root: root('player'), prefix: '/tv/', decorateReply: false, cacheControl: false,
    setHeaders: (res, path) => {
      // HTML e SW sempre revalidados; o resto pode ficar em cache curto
      res.setHeader('Cache-Control', /\.(html|js)$/.test(path) ? 'no-cache' : 'public, max-age=3600');
      if (path.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/tv/');
    },
  });
  app.get('/tv', (_req, reply) => reply.redirect('/tv/'));

  const webDist = root('web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist, prefix: '/', wildcard: false, cacheControl: false,
      setHeaders: (res, path) => res.setHeader('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'),
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && existsSync(webDist + '/index.html'))
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html', webDist);
    return reply.code(404).send({ error: 'Não encontrado.' });
  });

  return app;
}
