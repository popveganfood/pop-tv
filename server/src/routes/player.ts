// API usada pelas TVs. Nenhuma senha de usuário: só código de pareamento e credencial da tela.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomInt } from 'node:crypto';
import { q, one } from '../db.ts';
import { config } from '../config.ts';
import { HttpError, newToken, sha256 } from '../auth.ts';
import { limit } from '../ratelimit.ts';
import { decide, manifest, contentVersion, urlEpoch, invalidate } from '../resolver.ts';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para facilitar a leitura na TV
const PAIR_TTL_MIN = 10;
export const DEVICE_COOKIE = 'pop_device';
const cookieOpts = { path: '/api/player', httpOnly: true, sameSite: 'lax' as const, secure: config.isProd, maxAge: 400 * 86400 };

export async function deviceFromRequest(req: FastifyRequest) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.cookies[DEVICE_COOKIE];
  if (!token || token.length > 200) return null;
  return one<{ credential_id: string; screen_id: string; token: string }>(
    `select d.id as credential_id, d.screen_id from device_credentials d where d.token_hash = $1 and d.revoked_at is null`,
    [sha256(token)],
  ).then((r) => r && { ...r, token });
}

export default async function playerRoutes(app: FastifyInstance) {
  app.post('/api/player/pair/start', async (req) => {
    limit(`pair-start:${req.ip}`, 20, 10 * 60_000);
    const pollToken = newToken();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      try {
        const r = await one(`insert into pairing_sessions(code, poll_token_hash, expires_at, user_agent)
                             values ($1, $2, now() + interval '${PAIR_TTL_MIN} minutes', $3) returning expires_at`,
        [code, sha256(pollToken), String(req.headers['user-agent'] || '').slice(0, 300)]);
        await q(`delete from pairing_sessions where expires_at < now() - interval '1 day'`);
        return { code, poll_token: pollToken, expires_at: r.expires_at, ttl_seconds: PAIR_TTL_MIN * 60 };
      } catch (e: any) { if (e.code !== '23505') throw e; }
    }
    throw new HttpError(503, 'Não foi possível gerar o código. Tente novamente.');
  });

  app.post<{ Body: { poll_token: string } }>('/api/player/pair/poll', {
    schema: { body: { type: 'object', required: ['poll_token'], properties: { poll_token: { type: 'string', maxLength: 100 } } } },
  }, async (req, reply) => {
    limit(`pair-poll:${req.ip}`, 300, 60_000);
    const s = await one('select * from pairing_sessions where poll_token_hash = $1', [sha256(req.body.poll_token)]);
    if (!s || s.consumed_at) return { status: 'expired' };
    if (!s.claimed_at) return { status: new Date(s.expires_at) < new Date() ? 'expired' : 'waiting' };
    // entrega a credencial uma única vez (só o hash fica guardado)
    const consumed = await q('update pairing_sessions set consumed_at = now() where id = $1 and consumed_at is null returning id', [s.id]);
    if (!consumed.length) return { status: 'expired' };
    const token = newToken();
    await q('insert into device_credentials(screen_id, token_hash) values ($1, $2)', [s.screen_id, sha256(token)]);
    reply.setCookie(DEVICE_COOKIE, token, cookieOpts);
    return { status: 'paired', device_token: token, screen_id: s.screen_id };
  });

  type SyncBody = { version?: string; url_epoch?: number; state?: string; item?: string; error?: string; capabilities?: Record<string, unknown> };
  app.post<{ Body: SyncBody }>('/api/player/sync', {
    bodyLimit: 64 * 1024,
    schema: { body: { type: 'object', properties: {
      version: { type: 'string', maxLength: 64 }, url_epoch: { type: 'number' }, state: { type: 'string', maxLength: 40 },
      item: { type: 'string', maxLength: 200 }, error: { type: 'string', maxLength: 1000 }, capabilities: { type: 'object' },
    } } },
  }, async (req, reply) => {
    const dev = await deviceFromRequest(req);
    if (!dev) {
      reply.clearCookie(DEVICE_COOKIE, { path: '/api/player' });
      throw new HttpError(401, 'Tela não pareada ou acesso revogado.');
    }
    limit(`sync:${dev.credential_id}`, 30, 60_000);
    const b = req.body ?? {};
    const prev = await one<{ last_error: string | null; last_error_at: string | null }>(
      `update screens s set last_seen_at = now(), last_sync_at = now(), last_ip = $2, user_agent = $3,
              capabilities = coalesce($4::jsonb, capabilities), reported_version = $5, playback_state = $6, current_item = $7
         from (select last_error, last_error_at from screens where id = $1) old
        where s.id = $1 returning old.last_error, old.last_error_at`,
      [dev.screen_id, req.ip, String(req.headers['user-agent'] || '').slice(0, 300), b.capabilities ? JSON.stringify(b.capabilities) : null,
        b.version ?? null, b.state ?? null, b.item ?? null],
    );
    if (b.error) {
      const repeated = prev?.last_error === b.error && prev.last_error_at && Date.now() - new Date(prev.last_error_at).getTime() < 10 * 60_000;
      await q('update screens set last_error = $2, last_error_at = now() where id = $1', [dev.screen_id, b.error]);
      if (!repeated) {
        await q('insert into device_logs(screen_id, message) values ($1, $2)', [dev.screen_id, b.error]);
        await q(`delete from device_logs where screen_id = $1 and created_at < now() - interval '30 days'`, [dev.screen_id]);
      }
    }
    reply.setCookie(DEVICE_COOKIE, dev.token, cookieOpts); // renova a validade do cookie a cada sync
    const d = await decide(dev.screen_id);
    if (!d) { invalidate(); throw new HttpError(503, 'Atualizando configuração; tente de novo.'); } // credencial válida ⇒ tela existe
    if (b.version === contentVersion(d) && b.url_epoch === urlEpoch()) return { changed: false, poll_seconds: config.pollSeconds };
    return { changed: true, manifest: await manifest(d, config.pollSeconds) };
  });
}
