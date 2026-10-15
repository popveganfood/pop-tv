import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { q, one } from './db.ts';
import { config } from './config.ts';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = await scryptAsync(pw, Buffer.from(s, 'base64'), 64);
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && timingSafeEqual(want, key);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export type Role = 'admin' | 'marketing' | 'manager';
export type User = {
  id: string; email: string; name: string; role: Role;
  all_units: boolean; can_manage_screens: boolean; can_publish: boolean;
  unit_ids: string[];
};

declare module 'fastify' {
  interface FastifyRequest { user?: User }
}

export class HttpError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message); this.status = status; this.extra = extra;
  }
}
export const forbidden = (msg = 'Você não tem permissão para esta ação.') => new HttpError(403, msg);
export const notFound = (what = 'Registro') => new HttpError(404, `${what} não encontrado.`);
export const bad = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, msg, extra);

export const SESSION_COOKIE = 'pop_session';

export async function createSession(userId: string) {
  const token = newToken();
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  await q('insert into sessions(token_hash, user_id, expires_at) values ($1,$2,$3)', [sha256(token), userId, expires]);
  return { token, expires };
}

export async function userFromRequest(req: FastifyRequest): Promise<User | undefined> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return;
  const u = await one<User>(
    `select u.id, u.email, u.name, u.role, u.all_units, u.can_manage_screens, u.can_publish,
            coalesce(array(select unit_id from user_units uu where uu.user_id = u.id), '{}') as unit_ids
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.active`,
    [sha256(token)],
  );
  return u;
}

export async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
  const u = await userFromRequest(req);
  if (!u) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  req.user = u;
}

export const user = (req: FastifyRequest) => req.user as User;

// ---------- Regras de permissão (sempre no servidor) ----------
export const isAdmin = (u: User) => u.role === 'admin';
export const seesAllUnits = (u: User) => u.role === 'admin' || u.all_units;
export const canAccessUnit = (u: User, unitId: string) => seesAllUnits(u) || u.unit_ids.includes(unitId);

export function assertAdmin(u: User) { if (!isAdmin(u)) throw forbidden('Somente o administrador geral pode fazer isso.'); }
export function assertUnit(u: User, unitId: string) { if (!canAccessUnit(u, unitId)) throw forbidden('Você não tem acesso a esta unidade.'); }
export function assertContent(u: User) {
  if (u.role !== 'admin' && u.role !== 'marketing') throw forbidden('Somente administrador ou marketing gerenciam mídias e playlists.');
}
export function assertManageScreens(u: User, unitId: string) {
  if (isAdmin(u)) return;
  if (u.role === 'manager' && u.can_manage_screens && canAccessUnit(u, unitId)) return;
  throw forbidden('Você não tem permissão para gerenciar telas desta unidade.');
}
/** publicar = criar/alterar regras de exibição para um conjunto de unidades */
export function assertPublish(u: User, unitIds: string[], targetAll = false) {
  if (isAdmin(u)) return;
  const allowedRole = u.role === 'marketing' || (u.role === 'manager' && u.can_publish);
  if (!allowedRole) throw forbidden('Você não tem permissão para publicar.');
  if (targetAll && !u.all_units) throw forbidden('Publicar para todas as unidades exige acesso a todas as unidades.');
  for (const id of unitIds) if (!canAccessUnit(u, id)) throw forbidden('O alvo inclui unidade sem permissão para você.');
}
