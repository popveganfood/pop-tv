import type { FastifyInstance } from 'fastify';
import { q, one, tx } from '../db.ts';
import { config } from '../config.ts';
import {
  SESSION_COOKIE, createSession, verifyPassword, hashPassword, sha256, requireUser, user, assertAdmin,
  HttpError, bad, notFound, type User,
} from '../auth.ts';
import { limit } from '../ratelimit.ts';
import { audit } from '../audit.ts';

const ROLES = ['admin', 'marketing', 'manager'];

export default async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string; password: string } }>('/api/auth/login', {
    schema: { body: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', maxLength: 200 }, password: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    limit(`login:${req.ip}`, 10, 60_000);
    const email = req.body.email.trim().toLowerCase();
    limit(`login-email:${email}`, 20, 15 * 60_000);
    const u = await one('select id, password_hash, active from users where lower(email) = $1', [email]);
    // mesma resposta para e-mail inexistente e senha errada
    const ok = u ? await verifyPassword(req.body.password, u.password_hash) : await verifyPassword(req.body.password, 'scrypt$AAAA$AAAA');
    if (!u || !ok || !u.active) throw new HttpError(401, 'E-mail ou senha incorretos.');
    const s = await createSession(u.id);
    await q('update users set last_login_at = now() where id = $1', [u.id]);
    await q('delete from sessions where expires_at < now()');
    reply.setCookie(SESSION_COOKIE, s.token, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.isProd, expires: s.expires });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const t = req.cookies[SESSION_COOKIE];
    if (t) await q('delete from sessions where token_hash = $1', [sha256(t)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (req) => {
    const u = user(req);
    return { user: u };
  });

  // ---------------- Usuários (somente admin) ----------------
  const userBody = {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 }, email: { type: 'string', minLength: 3, maxLength: 200 },
      password: { type: 'string', minLength: 8, maxLength: 200 }, role: { type: 'string', enum: ROLES },
      active: { type: 'boolean' }, all_units: { type: 'boolean' }, can_manage_screens: { type: 'boolean' },
      can_publish: { type: 'boolean' }, unit_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 500 },
    },
    additionalProperties: false,
  };
  type UB = Partial<User & { password: string; active: boolean }>;

  app.get('/api/users', { preHandler: requireUser }, async (req) => {
    assertAdmin(user(req));
    return q(`select u.id, u.name, u.email, u.role, u.active, u.all_units, u.can_manage_screens, u.can_publish, u.last_login_at,
                     coalesce(array(select unit_id from user_units where user_id = u.id), '{}') as unit_ids
                from users u order by u.name`);
  });

  app.post<{ Body: UB }>('/api/users', { preHandler: requireUser, schema: { body: { ...userBody, required: ['name', 'email', 'password', 'role'] } } }, async (req) => {
    const me = user(req); assertAdmin(me);
    const b = req.body;
    const id = await tx(async (c) => {
      const r = await one('insert into users(name, email, password_hash, role, all_units, can_manage_screens, can_publish) values ($1,$2,$3,$4,$5,$6,$7) returning id',
        [b.name!.trim(), b.email!.trim().toLowerCase(), await hashPassword(b.password!), b.role, !!b.all_units, !!b.can_manage_screens, !!b.can_publish], c);
      for (const uid of b.unit_ids ?? []) await q('insert into user_units values ($1,$2)', [r.id, uid], c);
      await audit(me, 'criar', 'usuário', r.id, `Criou o usuário ${b.email} (${b.role})`, undefined, c);
      return r.id;
    });
    return { id };
  });

  app.patch<{ Params: { id: string }; Body: UB }>('/api/users/:id', { preHandler: requireUser, schema: { body: userBody } }, async (req) => {
    const me = user(req); assertAdmin(me);
    const b = req.body;
    if (req.params.id === me.id && (b.role && b.role !== 'admin' || b.active === false)) throw bad('Você não pode remover seu próprio acesso de administrador.');
    await tx(async (c) => {
      const cur = await one('select * from users where id = $1', [req.params.id], c);
      if (!cur) throw notFound('Usuário');
      await q(`update users set name=$2, email=$3, role=$4, active=$5, all_units=$6, can_manage_screens=$7, can_publish=$8 where id=$1`, [
        cur.id, b.name?.trim() ?? cur.name, b.email?.trim().toLowerCase() ?? cur.email, b.role ?? cur.role, b.active ?? cur.active,
        b.all_units ?? cur.all_units, b.can_manage_screens ?? cur.can_manage_screens, b.can_publish ?? cur.can_publish], c);
      if (b.password) {
        await q('update users set password_hash = $2 where id = $1', [cur.id, await hashPassword(b.password)], c);
        await q('delete from sessions where user_id = $1', [cur.id], c);
      }
      if (b.active === false) await q('delete from sessions where user_id = $1', [cur.id], c);
      if (b.unit_ids) {
        await q('delete from user_units where user_id = $1', [cur.id], c);
        for (const uid of b.unit_ids) await q('insert into user_units values ($1,$2)', [cur.id, uid], c);
      }
      await audit(me, 'editar', 'usuário', cur.id, `Editou o usuário ${cur.email}`, { ...b, password: b.password ? '***' : undefined }, c);
    });
    return { ok: true };
  });

  app.get<{ Querystring: { limit?: number } }>('/api/audit', { preHandler: requireUser }, async (req) => {
    assertAdmin(user(req));
    return q(`select a.id, a.action, a.entity_type, a.entity_id, a.summary, a.details, a.created_at, u.name as user_name
                from audit_logs a left join users u on u.id = a.user_id order by a.id desc limit $1`, [Math.min(Number(req.query.limit) || 100, 500)]);
  });
}
