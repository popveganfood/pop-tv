import { AwsClient } from 'aws4fetch';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { copyFile, mkdir, open, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { config } from './config.ts';

export interface Storage {
  presignPut(key: string, expiresSec?: number): Promise<{ url: string; method: 'PUT' }>;
  presignGet(key: string, expiresSec?: number): Promise<string>;
  size(key: string): Promise<number | null>;
  readRange(key: string, start: number, endInclusive: number): Promise<Buffer>;
  remove(key: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}

const safeKey = (k: string) => {
  if (!/^[a-z0-9][a-z0-9/_.-]*$/i.test(k) || k.includes('..')) throw new Error('chave inválida');
  return k;
};

// ---------------- S3 compatível: Cloudflare R2 ou Railway Buckets (produção) ----------------
function s3Storage(): Storage {
  const { endpoint, region, accessKeyId, secretAccessKey, bucket, virtualHosted } = config.s3;
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region });
  const base = virtualHosted ? endpoint.replace('://', `://${bucket}.`) + '/' : `${endpoint}/${bucket}/`;
  const presign = async (method: string, key: string, exp: number) =>
    (await aws.sign(`${base}${safeKey(key)}?X-Amz-Expires=${exp}`, { method, aws: { signQuery: true } })).url;
  return {
    async presignPut(key, exp = 900) { return { url: await presign('PUT', key, exp), method: 'PUT' }; },
    presignGet: (key, exp = 3 * 86400) => presign('GET', key, exp),
    async size(key) {
      const r = await aws.fetch(base + safeKey(key), { method: 'HEAD' });
      return r.ok ? Number(r.headers.get('content-length')) : null;
    },
    async readRange(key, a, b) {
      const r = await aws.fetch(base + safeKey(key), { headers: { Range: `bytes=${a}-${b}` } });
      if (!r.ok) throw new Error(`R2 ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    },
    async remove(key) { await aws.fetch(base + safeKey(key), { method: 'DELETE' }); },
    async copy(from, to) {
      const r = await aws.fetch(base + safeKey(to), { method: 'PUT', headers: { 'x-amz-copy-source': `/${bucket}/${safeKey(from)}` } });
      if (!r.ok) throw new Error(`R2 copy ${r.status}`);
    },
  };
}

// ---------------- Disco local (somente desenvolvimento e testes) ----------------
export const localSign = (method: string, key: string, exp: number) =>
  createHmac('sha256', config.appSecret).update(`${method}\n${key}\n${exp}`).digest('base64url');

export function verifyLocalSig(method: string, key: string, exp: number, sig: string) {
  if (!exp || exp * 1000 < Date.now()) return false;
  const want = Buffer.from(localSign(method, key, exp));
  const got = Buffer.from(sig || '');
  return want.length === got.length && timingSafeEqual(want, got);
}

export const localPath = (key: string) => {
  const root = resolve(config.localStorageDir);
  const p = resolve(join(root, safeKey(key)));
  if (!p.startsWith(root + '/')) throw new Error('chave inválida');
  return p;
};

function localStorage(): Storage {
  const url = (method: string, key: string, exp: number) => {
    const e = Math.floor(Date.now() / 1000) + exp;
    return `/api/dev-storage/${safeKey(key)}?e=${e}&s=${localSign(method, key, e)}`;
  };
  return {
    async presignPut(key, exp = 900) {
      await mkdir(dirname(localPath(key)), { recursive: true });
      return { url: url('PUT', key, exp), method: 'PUT' };
    },
    async presignGet(key, exp = 3 * 86400) { return url('GET', key, exp); },
    async size(key) { try { return (await stat(localPath(key))).size; } catch { return null; } },
    async readRange(key, a, b) {
      const fh = await open(localPath(key), 'r');
      try {
        const buf = Buffer.alloc(b - a + 1);
        const { bytesRead } = await fh.read(buf, 0, buf.length, a);
        return buf.subarray(0, bytesRead);
      } finally { await fh.close(); }
    },
    async remove(key) { await unlink(localPath(key)).catch(() => {}); },
    async copy(from, to) { await mkdir(dirname(localPath(to)), { recursive: true }); await copyFile(localPath(from), localPath(to)); },
  };
}

export const storage: Storage = config.storageDriver === 'local' ? localStorage() : s3Storage();

/** CORS do bucket para o painel enviar arquivos e as TVs guardarem em cache (aplicado ao iniciar). */
export async function ensureBucketCors(origin: string) {
  if (config.storageDriver === 'local') return;
  const { endpoint, region, accessKeyId, secretAccessKey, bucket, virtualHosted } = config.s3;
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region });
  const url = (virtualHosted ? endpoint.replace('://', `://${bucket}.`) + '/' : `${endpoint}/${bucket}/`) + '?cors';
  const body = `<CORSConfiguration><CORSRule><AllowedOrigin>${origin}</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>Content-Length</ExposeHeader><ExposeHeader>Content-Range</ExposeHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
  const md5 = createHash('md5').update(body).digest('base64');
  const r = await aws.fetch(url, { method: 'PUT', body, headers: { 'Content-Type': 'application/xml', 'Content-MD5': md5 } });
  if (!r.ok) console.warn(`[POP TV] não foi possível configurar o CORS do bucket (${r.status}): configure manualmente (docs/implantacao.md).`);
}
