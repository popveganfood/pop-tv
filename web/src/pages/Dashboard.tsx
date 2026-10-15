// Início = sala de controle: quantas telas estão no ar, o que cada uma mostra, o que entra hoje e o que precisa de atenção.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { get } from '../api.ts';
import { Button, Card, Loading, ErrorBox, Thumb, useLoad, ago, fmtLocal, useRoute } from '../ui.tsx';
import { useMe, can } from '../App.tsx';
import { PairModal, Tally, useScreenModals, type Screen } from './Screens.tsx';

type Dash = any;
const pad = (n: number) => String(n).padStart(2, '0');
const minutesOf = (naive: string) => { const [, hh, mm] = naive.match(/(\d{2}):(\d{2})$/)!; return +hh * 60 + +mm; };
const dayOf = (naive: string) => naive.slice(0, 10);
const state = (s: Screen) => (!s.paired ? 'unpaired' : s.online ? 'on' : 'off') as 'on' | 'off' | 'unpaired';
const SOURCE: Record<string, string> = { segurança: 'Playlist de segurança', nenhuma: 'Tela da marca · sem programação', desativada: 'Tela desativada' };

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

export default function Dashboard() {
  const me = useMe();
  const { data, error, loading, reload } = useLoad<Dash>(() => get('/api/dashboard'));
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [pair, setPair] = useState(false);
  const { go } = useRoute();
  const modals = useScreenModals(reload);
  const now = useClock();
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  useEffect(() => { if (data) setLoadedAt(Date.now()); }, [data]);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox msg={error} />;
  const d = data as Dash;
  const canPair = d.units.some((u: any) => can.screens(me, u.id));
  const today = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between animate-rise">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[.12em] text-cinza">Olá, {me.name.split(' ')[0]} · {today}</p>
          <h1 className="mt-1 text-3xl sm:text-[2.6rem] font-black tracking-tight leading-none">Sala de controle</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {can.content(me) && <Button variant="dark" onClick={() => go('/playlists')}>Trocar uma promoção</Button>}
          {canPair && <Button onClick={() => setPair(true)}>+ Adicionar tela</Button>}
        </div>
      </header>

      <ControlRoom d={d} now={now} loadedAt={loadedAt} modals={modals} canPair={canPair} onPair={() => setPair(true)} />

      {/* no celular "Precisa de atenção" vem primeiro; no computador fica à direita da linha do tempo */}
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_1fr] items-start">
        <div className="min-w-0 xl:row-span-2"><Timeline d={d} onSchedule={can.content(me) ? () => go('/programacao') : undefined} /></div>
        <div className="order-first xl:order-none"><Attention screens={d.screens} modals={modals} /></div>
        <Activity changes={d.changes} />
      </div>

      {modals.node}
      <PairModal open={pair} onClose={(p) => { setPair(false); if (p) reload(); }} />
    </>
  );
}

// ---------------- painel escuro: placar + mosaico de monitores ----------------
function ControlRoom({ d, now, loadedAt, modals, canPair, onPair }: { d: Dash; now: Date; loadedAt: number; modals: ReturnType<typeof useScreenModals>; canPair: boolean; onPair: () => void }) {
  const screens: Screen[] = d.screens;
  const c = d.counts;
  const unpaired = screens.filter((s) => !s.paired).length;
  const off = screens.filter((s) => s.paired && !s.online).length;
  const byUnit = useMemo(() => {
    const m = new Map<string, Screen[]>();
    for (const s of screens) m.set(s.unit_name, [...(m.get(s.unit_name) ?? []), s]);
    return [...m.entries()];
  }, [screens]);
  const secs = Math.max(0, Math.round((now.getTime() - loadedAt) / 1000));

  return (
    <section className="rounded-[22px] bg-grafite text-white overflow-hidden shadow-card animate-rise" aria-label="Telas ao vivo">
      <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end p-5 sm:p-7 border-b border-white/10">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] tracking-[.22em] text-white/55">
            <span className="live-dot" aria-hidden /> AO VIVO · <time className="tabular text-white/85">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</time>
          </p>
          <p className="mt-4 flex items-baseline gap-2 font-black leading-[.8] tracking-tight tabular">
            <span className="text-[clamp(72px,9vw,120px)]">{c.online}</span>
            <span className="text-[clamp(28px,3.4vw,44px)] text-white/30">de {c.screens}</span>
          </p>
          <p className="mt-2 text-sm font-semibold text-white/70">{c.screens ? (c.online === c.screens ? 'Todas as telas estão no ar.' : 'telas no ar agora') : 'Nenhuma tela cadastrada'}</p>
        </div>

        <div className="min-w-0 space-y-5">
          {screens.length > 0 && (
            <div>
              <div className="flex gap-1 h-3" role="img" aria-label={`${c.online} no ar, ${off} sem sinal, ${unpaired} sem pareamento`}>
                {screens.map((s, i) => (
                  <span key={s.id} title={`${s.name} — ${state(s) === 'on' ? 'no ar' : state(s) === 'off' ? 'sem sinal' : 'sem pareamento'}`}
                    className={`flex-1 rounded-[3px] bar-grow ${state(s) === 'on' ? 'bg-pop' : state(s) === 'off' ? 'bg-sinal' : 'bg-laranja'}`} style={{ animationDelay: `${i * 40}ms` }} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-white/55">
                <Legend dot="bg-pop">No ar</Legend><Legend dot="bg-sinal">Sem sinal · {off}</Legend>{unpaired > 0 && <Legend dot="bg-laranja">Sem pareamento · {unpaired}</Legend>}
                <span className="ml-auto font-mono">atualizado há {secs} s</span>
              </div>
            </div>
          )}
          <dl className="grid grid-cols-3 divide-x divide-white/10 rounded-xl bg-white/[.04] ring-1 ring-white/10">
            <Figure n={c.campaigns_live} label="Campanhas no ar" accent={c.campaigns_live > 0} />
            <Figure n={c.playlists_published} label="Playlists publicadas" />
            <Figure n={c.units} label={c.units === 1 ? 'Unidade' : 'Unidades'} />
          </dl>
        </div>
      </div>

      <div className="p-5 sm:p-7 space-y-8">
        {screens.length === 0 ? (
          <div className="tv-noise rounded-xl aspect-[21/9] max-h-72 w-full grid place-items-center text-center p-6">
            <div>
              <p className="font-mono text-xs tracking-[.3em] text-white/50">SEM SINAL</p>
              <p className="mt-2 text-xl font-black">Nenhuma TV conectada ainda</p>
              <p className="mt-1 text-sm text-white/60 max-w-md">Abra <b className="font-mono text-white">/tv</b> no navegador da TV e digite aqui o código que aparecer.</p>
              {canPair && <div className="mt-4"><Button onClick={onPair}>+ Adicionar tela</Button></div>}
            </div>
          </div>
        ) : byUnit.map(([unit, list]) => (
          <section key={unit}>
            <h2 className="flex items-baseline gap-3 mb-3">
              <span className="text-sm font-black uppercase tracking-[.14em]">{unit}</span>
              <span className="font-mono text-[11px] text-white/45 tabular">{list.filter((s) => s.online).length}/{list.length} no ar</span>
            </h2>
            <div className="grid gap-x-3 sm:gap-x-4 gap-y-5 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((s) => <Monitor key={s.id} s={s} modals={modals} />)}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

const Legend = ({ dot, children }: { dot: string; children: ReactNode }) => <span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-[2px] ${dot}`} />{children}</span>;

function Figure({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="px-4 py-3">
      <dd className={`font-mono text-2xl font-bold tabular ${accent ? 'text-laranja' : ''}`}>{n}</dd>
      <dt className="text-[11px] font-semibold text-white/55 leading-tight">{label}</dt>
    </div>
  );
}

/** Um monitor do mosaico: miniatura do que a TV deve estar mostrando, luz de "no ar" e legenda embaixo (como num multiviewer). */
function Monitor({ s, modals }: { s: Screen; modals: ReturnType<typeof useScreenModals> }) {
  const me = useMe();
  const st = state(s);
  const p = s.decision?.playlist;
  const portrait = s.orientation === 'portrait';
  return (
    <article className="min-w-0 animate-rise">
      <button type="button" onClick={() => modals.preview(s)} aria-label={`Simular a programação de ${s.name}`}
        className="group relative block w-full aspect-video rounded-lg overflow-hidden bg-black ring-1 ring-white/10 hover:ring-white/40 transition text-left">
        {st === 'off' ? (
          <div className="tv-noise absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className="font-mono text-[11px] tracking-[.3em] text-white/60">SEM SINAL</p>
              <p className="mt-1 text-xs text-white/45">último contato {ago(s.last_seen_at)}</p>
            </div>
          </div>
        ) : (
          <span className={`absolute ${portrait ? 'inset-y-0 left-1/2 -translate-x-1/2 aspect-[9/16]' : 'inset-0'} ${st === 'unpaired' ? 'opacity-40' : ''}`}>
            <Thumb url={p?.first?.thumb_url} kind={p?.first?.kind} className="w-full h-full" />
          </span>
        )}
        <span className="absolute top-2 left-2"><Tally s={s} /></span>
        {p && st !== 'off' && (
          <span className="absolute top-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/85" title={s.in_sync ? 'A TV confirmou esta versão' : 'Aguardando a TV confirmar'}>
            v{p.version} {s.in_sync ? '✓' : '…'}
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/55 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition">
          <span className="rounded-full bg-white text-preto text-xs font-bold px-3 py-1.5">▶ Simular</span>
        </span>
      </button>
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-sm leading-tight truncate">{s.name}{!s.active && <span className="text-white/45 font-semibold"> · desativada</span>}</p>
          <p className="text-xs text-white/55 truncate">{p ? p.name : SOURCE[s.decision?.source] ?? '—'}{s.environment_name ? ` · ${s.environment_name}` : ''}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <IconBtn label={`Gerenciar ${s.name}`} onClick={() => modals.manage(s)} d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
          {can.publish(me) && <IconBtn label={`Trocar programação de ${s.name}`} onClick={() => modals.switchProgram(s)} d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4" />}
        </div>
      </div>
    </article>
  );
}

function IconBtn({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="w-8 h-8 grid place-items-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition">
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
    </button>
  );
}

// ---------------- programação de hoje (linha do tempo 00h–24h) ----------------
const BAR: Record<number, string> = { 10: 'bg-tinta', 50: 'bg-laranja', 100: 'bg-pop' };
const BAR_TEXT: Record<number, string> = { 10: 'text-white', 50: 'text-preto', 100: 'text-white' };

function Timeline({ d, onSchedule }: { d: Dash; onSchedule?: () => void }) {
  const rows: any[] = d.timeline ?? [];
  const nowMin = minutesOf(d.now_local);
  const todayKey = dayOf(d.now_local);
  const later = (d.upcoming as any[]).filter((u) => dayOf(u.starts) !== todayKey);
  const pct = (m: number) => `${(m / 1440) * 100}%`;
  const toMin = (naive: string) => (dayOf(naive) > todayKey ? 1440 : minutesOf(naive));
  const city = String(d.timezone).split('/').pop()?.replace(/_/g, ' ');

  return (
    <Card className="p-5 sm:p-6 animate-rise">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-black">Programação de hoje</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-cinza">
          <Legend dot="bg-tinta">Padrão</Legend><Legend dot="bg-laranja">Campanha</Legend><Legend dot="bg-pop">Emergência</Legend>
          <span className="font-mono">hora de {city}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-xl border-2 border-dashed border-black/10 p-6 text-center">
          <p className="font-bold">Nada programado para hoje</p>
          <p className="text-sm text-cinza mt-1">As telas mostram a playlist de segurança até você publicar uma programação.</p>
          {onSchedule && <div className="mt-3"><Button size="sm" onClick={onSchedule}>Programar campanha</Button></div>}
        </div>
      ) : (
        <div className="mt-5">
          {/* régua de horas */}
          <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[190px_minmax(0,1fr)] gap-x-4">
            <span className="hidden sm:block" />
            <div className="relative h-5 font-mono text-[10px] text-cinza">
              {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
                <span key={h} className={`absolute top-0 ${h === 0 ? '' : h === 24 ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ left: pct(h * 60) }}>{pad(h)}h</span>
              ))}
            </div>
          </div>
          <ul className="space-y-2.5">
            {rows.map((r) => {
              const live = r.blocks.some((b: any) => minutesOf(b.start) <= nowMin && toMin(b.end) > nowMin);
              return (
                <li key={r.id} className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[190px_minmax(0,1fr)] gap-x-4 gap-y-1 items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-tight truncate" title={r.name}>{r.name}</p>
                    <p className="text-[11px] text-cinza truncate">{r.playlist_name} · {r.screens} {r.screens === 1 ? 'tela' : 'telas'}</p>
                  </div>
                  <div className="relative h-8 rounded-md bg-fundo overflow-hidden">
                    {[3, 6, 9, 12, 15, 18, 21].map((h) => <span key={h} className="absolute inset-y-0 w-px bg-black/[.06]" style={{ left: pct(h * 60) }} />)}
                    {r.blocks.map((b: any, i: number) => {
                      const a = minutesOf(b.start), z = toMin(b.end);
                      return (
                        <span key={i} title={`${r.name}: ${b.start.slice(11)}–${b.end.slice(11)}`}
                          className={`absolute inset-y-1 rounded-[5px] bar-grow flex items-center px-2 overflow-hidden ${BAR[r.priority]} ${BAR_TEXT[r.priority]} ${live ? 'ring-2 ring-offset-1 ring-pop/0' : 'opacity-60'}`}
                          style={{ left: pct(a), width: pct(Math.max(z - a, 8)) }}>
                          {z - a >= 300 && <span className="font-mono text-[10px] font-bold truncate">{b.start.slice(11)}–{z === 1440 ? '24:00' : b.end.slice(11)}</span>}
                        </span>
                      );
                    })}
                    <span className="absolute inset-y-0 w-0.5 bg-pop z-10" style={{ left: pct(nowMin) }} aria-hidden />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[190px_minmax(0,1fr)] gap-x-4">
            <span className="hidden sm:block" />
            <div className="relative h-6">
              <span className="absolute top-1 -translate-x-1/2 rounded bg-pop px-1.5 py-0.5 font-mono text-[10px] font-bold text-white" style={{ left: pct(Math.min(Math.max(nowMin, 30), 1410)) }}>
                agora {d.now_local.slice(11)}
              </span>
            </div>
          </div>
        </div>
      )}

      {later.length > 0 && (
        <div className="mt-5 pt-4 border-t border-linha">
          <p className="text-[11px] font-bold uppercase tracking-wider text-cinza mb-2">Próximos dias</p>
          <ul className="divide-y divide-linha">
            {later.slice(0, 4).map((u: any) => (
              <li key={u.id + u.starts} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold truncate">{u.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-cinza">{fmtLocal(u.starts)} · {u.priority_label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ---------------- precisa de atenção ----------------
type Issue = { key: string; level: 0 | 1 | 2; title: string; detail: string; action: string; run: () => void };

function Attention({ screens, modals }: { screens: Screen[]; modals: ReturnType<typeof useScreenModals> }) {
  const me = useMe();
  const issues: Issue[] = [];
  for (const s of screens) {
    if (!s.active) continue;
    if (!s.paired) issues.push({ key: s.id + 'p', level: 1, title: `${s.name} sem pareamento`, detail: 'Abra /tv nessa TV e pareie de novo com o código.', action: 'Gerenciar', run: () => modals.manage(s) });
    else if (!s.online) issues.push({ key: s.id + 'o', level: 2, title: `${s.name} sem sinal`, detail: `Último contato ${ago(s.last_seen_at)}. Verifique se a TV está ligada e com internet.`, action: 'Gerenciar', run: () => modals.manage(s) });
    else if (!s.in_sync && s.decision?.playlist) issues.push({ key: s.id + 's', level: 0, title: `${s.name} ainda não confirmou`, detail: 'A programação nova chega na próxima sincronização (até 30 s).', action: 'Simular', run: () => modals.preview(s) });
    if (s.last_error && s.paired) issues.push({ key: s.id + 'e', level: 1, title: `${s.name} relatou um erro`, detail: s.last_error, action: 'Gerenciar', run: () => modals.manage(s) });
    if (s.decision?.source === 'nenhuma' && can.publish(me)) issues.push({ key: s.id + 'n', level: 1, title: `${s.name} sem programação`, detail: 'Está mostrando só a tela da marca POP.', action: 'Trocar', run: () => modals.switchProgram(s) });
  }
  issues.sort((a, b) => b.level - a.level);
  const tone = ['bg-black/25', 'bg-laranja', 'bg-pop'];

  return (
    <Card className="p-5 animate-rise">
      <h2 className="flex items-center justify-between text-lg font-black">
        Precisa de atenção
        <span className={`min-w-7 h-7 px-2 grid place-items-center rounded-full font-mono text-xs ${issues.length ? 'bg-pop text-white' : 'bg-ok-soft text-ok'}`}>{issues.length}</span>
      </h2>
      {issues.length === 0 ? (
        <p className="mt-3 text-sm text-cinza">Tudo certo: todas as telas estão no ar e confirmaram a programação.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {issues.slice(0, 6).map((i) => (
            <li key={i.key} className="flex gap-3 rounded-xl bg-fundo p-3">
              <span className={`w-1 shrink-0 rounded-full ${tone[i.level]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-snug">{i.title}</p>
                <p className="text-xs text-cinza leading-snug break-words">{i.detail}</p>
              </div>
              <button onClick={i.run} className="self-center shrink-0 text-xs font-bold text-pop-dark hover:underline">{i.action}</button>
            </li>
          ))}
          {issues.length > 6 && <li className="text-xs text-cinza px-1">e mais {issues.length - 6}…</li>}
        </ul>
      )}
    </Card>
  );
}

// ---------------- últimas alterações ----------------
const VERB_DOT: Record<string, string> = { publicar: 'bg-pop', restaurar: 'bg-pop', parear: 'bg-laranja', revogar: 'bg-preto', excluir: 'bg-preto', remover: 'bg-preto' };
const initials = (n?: string | null) => (n ?? 'Sistema').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function Activity({ changes }: { changes: any[] }) {
  return (
    <Card className="p-5 animate-rise">
      <h2 className="text-lg font-black">Últimas alterações</h2>
      {changes.length === 0 ? <p className="mt-3 text-sm text-cinza">Nenhuma alteração registrada ainda.</p> : (
        <ol className="mt-4 relative">
          <span className="absolute left-[13px] top-2 bottom-2 w-px bg-linha" aria-hidden />
          {changes.slice(0, 5).map((a, i) => (
            <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
              <span className="relative z-10 w-7 h-7 shrink-0 grid place-items-center rounded-full bg-preto text-white text-[10px] font-black">
                {initials(a.user_name)}
                <span className={`absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${VERB_DOT[a.action] ?? 'bg-black/30'}`} />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm leading-snug">{a.summary}</p>
                <p className="text-[11px] text-cinza mt-0.5"><span className="font-semibold">{a.user_name ?? 'Sistema'}</span> · {ago(a.created_at)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

