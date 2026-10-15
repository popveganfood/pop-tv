// Snapshot em memória de tudo que decide o que cada TV exibe. Recarregado do banco só quando algo
// muda (qualquer mutação bem-sucedida em /api invalida — ver app.ts). Assim as sincronizações a cada
// 30 s não leem regras do banco, economizando egress do Supabase Free.
// ponytail: válido para 1 instância. Com várias instâncias, usar LISTEN/NOTIFY para invalidar.
import { createHash } from 'node:crypto';
import { q } from './db.ts';
import { resolve, type Rule, type ScreenCtx } from './schedule.ts';
import { storage } from './storage.ts';

export type VersionItem = {
  media_id: string; key: string; kind: 'image' | 'video'; mime: string; name: string;
  duration_ms: number | null; width: number | null; height: number | null; thumb_key?: string | null;
};
type Published = { id: string; name: string; version_id: string; version: number; items: VersionItem[] };
type ScreenInfo = ScreenCtx & { name: string; orientation: string; live: boolean };
type Snapshot = {
  rules: Rule[]; screens: Map<string, ScreenInfo>; published: Map<string, Published>;
  playlistNames: Map<string, string>; fallbackId: string | null; offlineAfter: number;
};

let snap: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;
let generation = 0;
let loadingGen = -1;

export function invalidate() { generation++; snap = null; }

export async function snapshot(): Promise<Snapshot> {
  if (snap) return snap;
  if (loading && loadingGen === generation) return loading;
  const gen = generation;
  loadingGen = gen;
  loading = (async () => {
    const [rules, screens, members, pubs, names, org] = await Promise.all([
      q<Rule>(`select id, name, playlist_id, target_type, target_id, priority, start_at, end_at, time_start, time_end,
                      weekdays, enabled, to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
                 from schedules where enabled`),
      q(`select s.id, s.name, s.unit_id, s.orientation, u.timezone,
                (s.active and u.active and u.archived_at is null) as live
           from screens s join units u on u.id = s.unit_id`),
      q(`select group_id, screen_id from screen_group_members`),
      q(`select p.id, p.name, v.id as version_id, v.version, v.items
           from playlists p join published_versions v on v.id = p.published_version_id`),
      q(`select id, name from playlists`),
      q(`select fallback_playlist_id, offline_after_seconds from organizations where id = 1`),
    ]);
    const s: Snapshot = {
      rules,
      screens: new Map(screens.map((x) => [x.id, { ...x, group_ids: [] }])),
      published: new Map(pubs.map((p) => [p.id, p])),
      playlistNames: new Map(names.map((p) => [p.id, p.name])),
      fallbackId: org[0]?.fallback_playlist_id ?? null,
      offlineAfter: org[0]?.offline_after_seconds ?? 90,
    };
    for (const m of members) s.screens.get(m.screen_id)?.group_ids.push(m.group_id);
    if (gen === generation) snap = s;
    return s;
  })();
  const mine = loading;
  mine.finally(() => { if (loading === mine) loading = null; }).catch(() => {});
  return mine;
}

export type Decision = {
  screen: ScreenInfo;
  rule: Rule | null;
  playlist: Published | null;
  source: 'regra' | 'segurança' | 'nenhuma' | 'desativada';
  explanation: string;
  active: Rule[];
  localTime: string;
  skipped: string[];
};

export async function decide(screenId: string, at = new Date()): Promise<Decision | null> {
  const s = await snapshot();
  const screen = s.screens.get(screenId);
  if (!screen) return null;
  if (!screen.live)
    return { screen, rule: null, playlist: null, source: 'desativada', explanation: 'Tela ou unidade desativada/arquivada: exibindo tela da marca.', active: [], localTime: '', skipped: [] };
  const r = resolve(s.rules, screen, at);
  const skipped: string[] = [];
  // regra cuja playlist ainda não foi publicada não pode apagar a TV: passa para a próxima
  for (const rule of r.active) {
    const p = s.published.get(rule.playlist_id);
    if (p && p.items.length) {
      const explanation = rule === r.winner ? r.explanation
        : `Regra "${rule.name}" em uso porque ${skipped.join(', ')} ainda não tem conteúdo publicado.`;
      return { screen, rule, playlist: p, source: 'regra', explanation, active: r.active, localTime: r.localTime, skipped };
    }
    skipped.push(`"${rule.name}"`);
  }
  const fb = s.fallbackId ? s.published.get(s.fallbackId) ?? null : null;
  const why = r.active.length ? `Regras ativas sem conteúdo publicado (${skipped.join(', ')}): ` : 'Nenhuma regra ativa: ';
  if (fb && fb.items.length)
    return { screen, rule: null, playlist: fb, source: 'segurança', explanation: why + 'tocando a playlist de segurança.', active: r.active, localTime: r.localTime, skipped };
  return { screen, rule: null, playlist: null, source: 'nenhuma', explanation: why + 'playlist de segurança vazia — TV mostra a tela da marca POP.', active: r.active, localTime: r.localTime, skipped };
}

/** versão "lógica" do que a TV deve tocar; muda quando playlist/regra/arquivos mudam */
export function contentVersion(d: Decision) {
  const base = d.playlist ? `${d.playlist.version_id}|${d.rule?.id ?? 'fb'}|${d.screen.orientation}` : `vazio|${d.source}`;
  return createHash('sha1').update(base).digest('hex').slice(0, 16);
}

// URLs assinadas são reaproveitadas por um dia para não mudar o manifesto a cada sync.
const URL_TTL_S = 3 * 86400;
const EPOCH_MS = 86400_000;
const urlCache = new Map<string, string>();
export async function signedUrl(key: string) {
  const epoch = Math.floor(Date.now() / EPOCH_MS);
  const ck = `${epoch}:${key}`;
  let u = urlCache.get(ck);
  if (!u) {
    if (urlCache.size > 5000) urlCache.clear();
    u = await storage.presignGet(key, URL_TTL_S);
    urlCache.set(ck, u);
  }
  return u;
}
export const urlEpoch = () => Math.floor(Date.now() / EPOCH_MS);

export async function manifest(d: Decision, pollSeconds: number) {
  const items = [];
  for (const it of d.playlist?.items ?? []) {
    items.push({
      key: it.key.replace(/[^a-z0-9]/gi, '_'),
      kind: it.kind, mime: it.mime, url: await signedUrl(it.key),
      duration_ms: it.kind === 'image' ? it.duration_ms ?? 10_000 : null,
      width: it.width, height: it.height, name: it.name,
    });
  }
  return {
    version: contentVersion(d),
    url_epoch: urlEpoch(),
    poll_seconds: pollSeconds,
    screen: { id: d.screen.id, name: d.screen.name, orientation: d.screen.orientation },
    playlist: d.playlist ? { id: d.playlist.id, name: d.playlist.name, version: d.playlist.version } : null,
    rule: d.rule ? { id: d.rule.id, name: d.rule.name, priority: d.rule.priority } : null,
    source: d.source,
    items,
  };
}
