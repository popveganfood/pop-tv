import { HttpError } from './auth.ts';

// ponytail: contador em memória por processo; com várias instâncias, mover para tabela no Postgres.
const hits = new Map<string, { n: number; reset: number }>();

export function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  h.n++;
  if (h.n > max) {
    const s = Math.ceil((h.reset - now) / 1000);
    throw new HttpError(429, `Muitas tentativas. Aguarde ${s} segundos e tente de novo.`);
  }
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}

export function resetLimits() { hits.clear(); }
