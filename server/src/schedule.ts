// Regras de exibição: funções puras (sem banco), testadas em server/test/schedule.test.ts.
//
// Ordem de decisão para uma tela num instante (horário local da unidade da tela):
//   1. maior prioridade (Emergência 100 > Campanha 50 > Padrão 10)
//   2. alvo mais específico (tela > grupo > unidade > todas)
//   3. regra criada mais recentemente
// Sem regra ativa → playlist de segurança da organização.

export type TargetType = 'all' | 'unit' | 'group' | 'screen';
export type Rule = {
  id: string; name: string; playlist_id: string;
  target_type: TargetType; target_id: string | null;
  priority: number;
  start_at: string | null; end_at: string | null;   // 'YYYY-MM-DD HH:MM[:SS]' local
  time_start: string | null; time_end: string | null; // 'HH:MM[:SS]' local
  weekdays: number[] | null;                          // 0=domingo
  enabled: boolean;
  created_at: string;
};
export type ScreenCtx = { id: string; unit_id: string; group_ids: string[]; timezone: string };

export const PRIORITY = { padrao: 10, campanha: 50, emergencia: 100 } as const;
export const PRIORITY_LABEL: Record<number, string> = { 10: 'Padrão', 50: 'Campanha', 100: 'Emergência' };
export const SPECIFICITY: Record<TargetType, number> = { screen: 4, group: 3, unit: 2, all: 1 };
const TARGET_LABEL: Record<TargetType, string> = { screen: 'tela', group: 'grupo', unit: 'unidade', all: 'todas as unidades' };

const MIN = 60_000, DAY = 1440 * MIN;

/** 'YYYY-MM-DD HH:MM[:SS]' (ou com 'T') → ms "ingênuo" (UTC usado só como contêiner). */
export function naive(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) throw new Error(`data/hora inválida: ${s}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}
const minutesOf = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Instante real → ms ingênuo no fuso informado. */
export function localNaive(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
export const fmtNaive = (ms: number) => new Date(ms).toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:MM'

/** Hora local (ms ingênuo) num fuso → instante real. */
export function fromLocal(local: number, timeZone: string): Date {
  let t = local;
  for (let i = 0; i < 3; i++) t = local - (localNaive(new Date(t), timeZone) - t);
  return new Date(t);
}

export function isValidTimeZone(tz: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** A regra está no ar no instante local `t` (ms ingênuo)? Ignora alvo. */
export function activeAtLocal(r: Rule, t: number): boolean {
  if (!r.enabled) return false;
  if (r.start_at && t < naive(r.start_at)) return false;
  if (r.end_at && t >= naive(r.end_at)) return false;
  const dayStart = t - (t % DAY);
  const minute = Math.floor((t - dayStart) / MIN);
  const weekdayOf = (ms: number) => new Date(ms).getUTCDay();
  const okDay = (ms: number) => !r.weekdays || r.weekdays.length === 0 || r.weekdays.includes(weekdayOf(ms));
  if (!r.time_start || !r.time_end) return okDay(t);
  const a = minutesOf(r.time_start), b = minutesOf(r.time_end);
  if (a < b) return minute >= a && minute < b && okDay(t);
  // janela atravessa a meia-noite: o dia da semana é o do início da janela
  if (minute >= a) return okDay(t);
  if (minute < b) return okDay(t - DAY);
  return false;
}

export function targets(r: Rule, s: ScreenCtx) {
  switch (r.target_type) {
    case 'all': return true;
    case 'unit': return r.target_id === s.unit_id;
    case 'group': return !!r.target_id && s.group_ids.includes(r.target_id);
    case 'screen': return r.target_id === s.id;
  }
}

export function compareRules(a: Rule, b: Rule) {
  return b.priority - a.priority
    || SPECIFICITY[b.target_type] - SPECIFICITY[a.target_type]
    || (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0);
}

export type Resolution = { winner: Rule | null; active: Rule[]; explanation: string; localTime: string };

export function resolve(rules: Rule[], s: ScreenCtx, at: Date): Resolution {
  const t = localNaive(at, s.timezone);
  const active = rules.filter((r) => targets(r, s) && activeAtLocal(r, t)).sort(compareRules);
  const w = active[0] ?? null;
  let explanation = 'Nenhuma regra ativa: tocando a playlist de segurança.';
  if (w) {
    explanation = `Regra "${w.name}" (${PRIORITY_LABEL[w.priority] ?? w.priority}, alvo: ${TARGET_LABEL[w.target_type]})`;
    const next = active[1];
    if (next) {
      const why = next.priority !== w.priority ? 'tem prioridade maior'
        : next.target_type !== w.target_type ? 'tem alvo mais específico' : 'é mais recente';
      explanation += ` vence "${next.name}" porque ${why}.`;
    } else explanation += ' é a única ativa agora.';
  }
  return { winner: w, active, explanation, localTime: fmtNaive(t) };
}

/**
 * Conflito ambíguo = mesma prioridade, mesmo nível de alvo, pelo menos uma tela em comum e
 * algum minuto em que as duas estão no ar. Esses casos são recusados ao salvar.
 * ponytail: varredura minuto a minuto de até 8 dias (≤ 11.520 passos por par); trocar por
 * interseção de intervalos se houver milhares de regras.
 */
export function timeOverlap(a: Rule, b: Rule): string | null {
  const lo = Math.max(a.start_at ? naive(a.start_at) : -Infinity, b.start_at ? naive(b.start_at) : -Infinity);
  const hi = Math.min(a.end_at ? naive(a.end_at) : Infinity, b.end_at ? naive(b.end_at) : Infinity);
  if (lo >= hi) return null;
  let start: number;
  if (Number.isFinite(lo)) start = lo;
  else if (Number.isFinite(hi)) start = hi - 8 * DAY;
  else start = Date.UTC(2026, 0, 4); // um domingo qualquer: padrão semanal se repete
  start -= start % MIN;
  const end = Math.min(hi, start + 8 * DAY);
  const A = { ...a, enabled: true }, B = { ...b, enabled: true };
  for (let t = start; t < end; t += MIN) if (activeAtLocal(A, t) && activeAtLocal(B, t)) return fmtNaive(t);
  return null;
}

export function findConflicts(rule: Rule, others: Rule[], screensOf: (r: Rule) => Set<string>) {
  const mine = screensOf(rule);
  const out: { rule: Rule; at: string; screens: string[] }[] = [];
  for (const o of others) {
    if (o.id === rule.id || !o.enabled || !rule.enabled) continue;
    if (o.priority !== rule.priority || o.target_type !== rule.target_type) continue;
    const shared = [...screensOf(o)].filter((id) => mine.has(id));
    if (!shared.length) continue;
    const at = timeOverlap(rule, o);
    if (at) out.push({ rule: o, at, screens: shared });
  }
  return out;
}

/** Blocos [início, fim) em que a regra fica no ar entre `from` e `from + days` (locais). */
export function blocks(r: Rule, from: number, days: number, step = 5 * MIN) {
  const out: { start: string; end: string }[] = [];
  let open: number | null = null;
  const end = from + days * DAY;
  for (let t = from; t <= end; t += step) {
    const on = t < end && activeAtLocal(r, t);
    if (on && open === null) open = t;
    if (!on && open !== null) { out.push({ start: fmtNaive(open), end: fmtNaive(t) }); open = null; }
  }
  return out;
}

/** Validação de regra vinda do painel; devolve mensagem em português ou null. */
export function validateRule(r: Partial<Rule>): string | null {
  if (!r.name?.trim()) return 'Dê um nome para a programação.';
  if (!r.playlist_id) return 'Escolha uma playlist.';
  if (!r.target_type || !(r.target_type in SPECIFICITY)) return 'Escolha onde exibir.';
  if (r.target_type !== 'all' && !r.target_id) return 'Escolha a unidade, grupo ou tela.';
  if (![10, 50, 100].includes(r.priority as number)) return 'Prioridade inválida.';
  try {
    if (r.start_at) naive(r.start_at);
    if (r.end_at) naive(r.end_at);
  } catch { return 'Data/hora inválida.'; }
  if (r.priority === 100 && !r.end_at) return 'Campanha emergencial precisa de data e hora de término.';
  if (r.start_at && r.end_at && naive(r.end_at) <= naive(r.start_at)) return 'O término precisa ser depois do início.';
  const re = /^\d{2}:\d{2}(:\d{2})?$/;
  if (!!r.time_start !== !!r.time_end) return 'Informe hora inicial e final (ou nenhuma).';
  if (r.time_start && (!re.test(r.time_start) || !re.test(r.time_end!))) return 'Horário inválido.';
  if (r.time_start && minutesOf(r.time_start) === minutesOf(r.time_end!)) return 'Hora inicial e final não podem ser iguais.';
  if (r.weekdays && (r.weekdays.length === 0 || r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)))
    return 'Escolha ao menos um dia da semana.';
  return null;
}
