import { useEffect, useMemo, useState } from 'react';
import { get, post, patch, del } from '../api.ts';
import {
  Button, Card, PageHeader, Field, Input, Select, Toggle, Badge, Empty, Loading, ErrorBox, Modal,
  useLoad, useAction, useConfirm, fmtLocal, WEEKDAYS,
} from '../ui.tsx';
import { useMe, can } from '../App.tsx';

const PRIOS = [
  { v: 10, label: 'Padrão', text: 'Programação do dia a dia.', tone: 'neutro' as const },
  { v: 50, label: 'Campanha', text: 'Passa por cima da programação padrão.', tone: 'laranja' as const },
  { v: 100, label: 'Emergência', text: 'Vence tudo. Exige data e hora de término.', tone: 'pop' as const },
];
const prioTone = (p: number) => (p >= 100 ? 'pop' : p >= 50 ? 'laranja' : 'neutro');
const prioBar = (p: number) => (p >= 100 ? 'bg-pop' : p >= 50 ? 'bg-laranja' : 'bg-preto');

export function ruleWhen(r: any) {
  const parts: string[] = [];
  if (r.start_at || r.end_at) parts.push(`${r.start_at ? `de ${fmtLocal(r.start_at)}` : 'desde já'} ${r.end_at ? `até ${fmtLocal(r.end_at)}` : 'sem fim'}`);
  if (r.time_start) parts.push(`${r.time_start.slice(0, 5)}–${r.time_end.slice(0, 5)}`);
  if (r.weekdays?.length) parts.push(r.weekdays.map((d: number) => WEEKDAYS[d]).join(', '));
  return parts.length ? parts.join(' · ') : 'Sempre';
}

export default function Schedules() {
  const me = useMe();
  const [tab, setTab] = useState<'lista' | 'calendario'>('lista');
  const { data, error, loading, reload } = useLoad(() => get('/api/schedules'));
  const [edit, setEdit] = useState<any>(null);
  const { run } = useAction();
  const confirm = useConfirm();
  const status = (r: any) => {
    const now = new Date().toISOString().slice(0, 16);
    if (!r.enabled) return <Badge tone="neutro">Pausada</Badge>;
    if (r.end_at && r.end_at.replace(' ', 'T') <= now) return <Badge tone="neutro">Encerrada</Badge>;
    if (r.active_now_on) return <Badge tone="ok">No ar em {r.active_now_on} tela(s)</Badge>;
    if (!r.playlist_published) return <Badge tone="laranja">Playlist não publicada</Badge>;
    return <Badge tone="neutro">Fora do horário</Badge>;
  };
  return (
    <>
      {confirm.node}
      <PageHeader title="Programação" mark="automática" sub="Escolha o que toca, onde e quando. A regra mais forte vence: Emergência > Campanha > Padrão; empate → alvo mais específico (tela > grupo > unidade > todas)."
        actions={can.publish(me) && <Button size="lg" onClick={() => setEdit({})}>+ Nova programação</Button>} />
      <div className="flex gap-1 border-b border-linha mb-6">
        {([['lista', 'Programações'], ['calendario', 'Calendário da semana']] as const).map(([k, l]) =>
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm font-bold border-b-4 -mb-px ${tab === k ? 'border-pop' : 'border-transparent text-cinza'}`}>{l}</button>)}
      </div>
      {error && <ErrorBox msg={error} />}
      {tab === 'lista' && (loading && !data ? <Loading /> : !data?.length ? <Empty title="Nenhuma programação" text="Sem programação, as TVs tocam a playlist de segurança." action={can.publish(me) && <Button onClick={() => setEdit({})}>+ Nova programação</Button>} /> : (
        <div className="space-y-2">
          {data.map((r: any) => (
            <Card key={r.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className={`w-1.5 self-stretch rounded-full hidden md:block ${prioBar(r.priority)}`} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-black">{r.name}</p>
                  <Badge tone={prioTone(r.priority)}>{r.priority_label}</Badge>
                  {status(r)}
                </div>
                <p className="text-sm mt-1"><span className="text-cinza">Playlist</span> <b>{r.playlist_name}</b> <span className="text-cinza">em</span> <b>{r.target_label}</b> <span className="text-cinza">({r.screen_count} tela(s))</span></p>
                <p className="text-xs text-cinza mt-0.5">{ruleWhen(r)} · por {r.created_by_name ?? '—'}</p>
              </div>
              {r.can_edit && (
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => run(() => patch(`/api/schedules/${r.id}`, { enabled: !r.enabled }), r.enabled ? 'Programação pausada.' : 'Programação reativada.').then(reload)}>{r.enabled ? 'Pausar' : 'Reativar'}</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { if (await confirm.ask('Remover programação?', `"${r.name}" sai do ar e as TVs voltam para a regra seguinte.`, 'Remover')) run(() => del(`/api/schedules/${r.id}`), 'Programação removida.').then(reload); }}>Remover</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      ))}
      {tab === 'calendario' && <Calendar />}
      {edit && <RuleForm rule={edit} onClose={(saved) => { setEdit(null); if (saved) reload(); }} />}
    </>
  );
}

function RuleForm({ rule, onClose }: { rule: any; onClose: (saved: boolean) => void }) {
  const { data: playlists } = useLoad(() => get('/api/playlists'));
  const { data: units } = useLoad(() => get('/api/units'));
  const { data: groups } = useLoad(() => get('/api/groups'));
  const { data: screens } = useLoad(() => get('/api/screens'));
  const isNew = !rule.id;
  const [f, setF] = useState<any>({
    name: rule.name ?? '', playlist_id: rule.playlist_id ?? '', target_type: rule.target_type ?? 'unit', target_id: rule.target_id ?? '',
    priority: rule.priority ?? 10, enabled: rule.enabled ?? true,
    usePeriod: !!(rule.start_at || rule.end_at), start_at: rule.start_at?.slice(0, 16).replace(' ', 'T') ?? '', end_at: rule.end_at?.slice(0, 16).replace(' ', 'T') ?? '',
    useWindow: !!rule.time_start, time_start: rule.time_start?.slice(0, 5) ?? '11:00', time_end: rule.time_end?.slice(0, 5) ?? '15:00',
    weekdays: rule.weekdays ?? [0, 1, 2, 3, 4, 5, 6],
  });
  const body = useMemo(() => ({
    name: f.name, playlist_id: f.playlist_id || undefined, target_type: f.target_type, target_id: f.target_type === 'all' ? null : f.target_id || null,
    priority: f.priority, enabled: f.enabled,
    start_at: f.usePeriod && f.start_at ? f.start_at.replace('T', ' ') : null, end_at: (f.usePeriod || f.priority === 100) && f.end_at ? f.end_at.replace('T', ' ') : null,
    time_start: f.useWindow ? f.time_start : null, time_end: f.useWindow ? f.time_end : null,
    weekdays: f.weekdays.length === 7 ? null : f.weekdays,
  }), [f]);
  const [check, setCheck] = useState<any>(null);
  useEffect(() => {
    if (!body.playlist_id || (body.target_type !== 'all' && !body.target_id)) { setCheck(null); return; }
    const t = setTimeout(() => post(`/api/schedules/check${rule.id ? `?id=${rule.id}` : ''}`, { ...body, name: body.name || 'x' }).then(setCheck).catch((e) => setCheck({ error: e.message })), 400);
    return () => clearTimeout(t);
  }, [body, rule.id]);
  const { run, busy } = useAction();
  const save = async () => {
    const r = await run(() => (isNew ? post('/api/schedules', body) : patch(`/api/schedules/${rule.id}`, body)), isNew ? 'Programação criada. As TVs atualizam em até 30 s.' : 'Programação salva.');
    if (r) onClose(true);
  };
  const targets = { unit: units, group: groups, screen: screens }[f.target_type as 'unit'] ?? [];
  const hasConflict = !!check?.conflicts?.length;
  return (
    <Modal open onClose={() => onClose(false)} title={isNew ? 'Nova programação' : 'Editar programação'} wide
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button disabled={busy || hasConflict || !!check?.error || !f.name || !f.playlist_id} onClick={save}>{isNew ? 'Agendar' : 'Salvar'}</Button></>}>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Almoço — buffet do dia" /></Field>
          <Field label="1. O que tocar (playlist)">
            <Select value={f.playlist_id} onChange={(e) => setF({ ...f, playlist_id: e.target.value })}>
              <option value="">Escolha…</option>
              {playlists?.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.published_version ? ` (v${p.published_version})` : ' — não publicada'}</option>)}
            </Select>
          </Field>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-cinza mb-1">2. Onde exibir</p>
            <div className="grid grid-cols-4 gap-1 mb-2">
              {([['all', 'Todas'], ['unit', 'Unidade'], ['group', 'Grupo'], ['screen', 'Uma TV']] as const).map(([k, l]) =>
                <button key={k} type="button" onClick={() => setF({ ...f, target_type: k, target_id: '' })} className={`h-10 rounded-xl text-sm font-bold border-2 ${f.target_type === k ? 'border-pop bg-pop-soft' : 'border-linha'}`}>{l}</button>)}
            </div>
            {f.target_type !== 'all' && (
              <Select value={f.target_id} onChange={(e) => setF({ ...f, target_id: e.target.value })}>
                <option value="">Escolha…</option>
                {targets?.map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.unit_name ? ` — ${t.unit_name}` : ''}</option>)}
              </Select>
            )}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-cinza mb-1">Prioridade</p>
            <div className="grid grid-cols-3 gap-2">
              {PRIOS.map((p) => (
                <button key={p.v} type="button" onClick={() => setF({ ...f, priority: p.v, usePeriod: p.v === 100 ? true : f.usePeriod })}
                  className={`text-left rounded-xl border-2 p-2.5 ${f.priority === p.v ? 'border-pop bg-pop-soft' : 'border-linha'}`}>
                  <p className="font-black text-sm">{p.label}</p><p className="text-[11px] text-cinza leading-snug">{p.text}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-cinza">3. Quando (hora local de cada unidade)</p>
          <Card className="p-3 space-y-3">
            <Toggle checked={f.usePeriod || f.priority === 100} onChange={(v) => setF({ ...f, usePeriod: v })} label="Período com início e fim (campanha temporária)" />
            {(f.usePeriod || f.priority === 100) && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Começa"><Input type="datetime-local" value={f.start_at} onChange={(e) => setF({ ...f, start_at: e.target.value })} /></Field>
                <Field label="Termina"><Input type="datetime-local" value={f.end_at} onChange={(e) => setF({ ...f, end_at: e.target.value })} /></Field>
              </div>
            )}
          </Card>
          <Card className="p-3 space-y-3">
            <Toggle checked={f.useWindow} onChange={(v) => setF({ ...f, useWindow: v })} label="Só em um horário do dia" />
            {f.useWindow && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Das"><Input type="time" value={f.time_start} onChange={(e) => setF({ ...f, time_start: e.target.value })} /></Field>
                <Field label="Até" hint={f.time_end < f.time_start ? 'Atravessa a meia-noite.' : undefined}><Input type="time" value={f.time_end} onChange={(e) => setF({ ...f, time_end: e.target.value })} /></Field>
              </div>
            )}
            <div>
              <p className="text-xs font-bold text-cinza mb-1">Dias da semana</p>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((d, i) => {
                  const on = f.weekdays.includes(i);
                  return <button key={d} type="button" onClick={() => setF({ ...f, weekdays: on ? f.weekdays.filter((x: number) => x !== i) : [...f.weekdays, i].sort() })}
                    className={`w-11 h-9 rounded-lg text-xs font-bold ${on ? 'bg-preto text-white' : 'bg-black/5'}`}>{d}</button>;
                })}
              </div>
            </div>
          </Card>
          <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={f.enabled ? 'Ativa' : 'Pausada'} />
          <Card className={`p-3 text-sm ${hasConflict || check?.error ? 'bg-pop-soft' : 'bg-fundo'}`}>
            <p className="font-black mb-1">Resultado previsto</p>
            {!check ? <p className="text-cinza">Escolha a playlist e onde exibir para ver o resultado.</p>
              : check.error ? <p className="text-pop-dark font-semibold">{check.error}</p>
              : hasConflict ? (
                <div className="text-pop-dark font-semibold">
                  <p>Conflito: mesma prioridade e mesmo tipo de alvo, no ar ao mesmo tempo. Ajuste a prioridade, o horário ou o alvo.</p>
                  <ul className="list-disc ml-5 mt-1 font-normal">{check.conflicts.map((c: any) => <li key={c.id}>"{c.name}" — ex.: {fmtLocal(c.at)} em {c.screens.join(', ')}</li>)}</ul>
                </div>
              ) : <p>Atinge <b>{check.affected}</b> tela(s) hoje cadastradas{f.target_type === 'all' || f.target_type === 'unit' ? ' (e as que forem adicionadas depois)' : ''}. Sem conflitos.</p>}
          </Card>
        </div>
      </div>
    </Modal>
  );
}

function Calendar() {
  const { data: units } = useLoad(() => get('/api/units'));
  const [unit, setUnit] = useState('');
  useEffect(() => { if (!unit && units?.length) setUnit(units[0].id); }, [units, unit]);
  const { data, loading } = useLoad(() => (unit ? get(`/api/calendar?unit_id=${unit}&days=7`) : Promise.resolve(null)), [unit]);
  const days = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: data.days }, (_, i) => { const d = new Date(`${data.from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  }, [data]);
  const seg = (b: { start: string; end: string }, day: string) => {
    const ds = `${day}T00:00`, de = `${day}T24:00`;
    if (b.end <= ds || b.start >= de) return null;
    const m = (s: string) => (s < ds ? 0 : s >= de ? 1440 : Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16)));
    return { left: (m(b.start) / 1440) * 100, width: ((m(b.end > de ? de : b.end) - m(b.start)) / 1440) * 100 || (100 - (m(b.start) / 1440) * 100) };
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select value={unit} onChange={(e) => setUnit(e.target.value)} className="max-w-xs">{units?.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        <span className="text-xs text-cinza">Próximos 7 dias no fuso {data?.unit?.timezone}. Barras: preto = Padrão, laranja = Campanha, vermerosa = Emergência.</span>
      </div>
      {loading && !data ? <Loading /> : !data?.rules.length ? <Empty title="Nada programado para esta unidade" text="Sem regras, as TVs tocam a playlist de segurança." /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-linha">
                <th className="text-left p-3 w-64">Programação</th>
                {days.map((d) => { const dt = new Date(`${d}T12:00:00Z`); return <th key={d} className="p-2 text-xs font-bold text-cinza">{WEEKDAYS[dt.getUTCDay()]} {d.slice(8, 10)}/{d.slice(5, 7)}</th>; })}
              </tr>
            </thead>
            <tbody>
              {data.rules.map((r: any) => (
                <tr key={r.id} className="border-b border-linha/70">
                  <td className="p-3 align-top">
                    <p className="font-bold leading-tight">{r.name}</p>
                    <p className="text-xs text-cinza">{r.playlist_name} · {r.target_label}</p>
                  </td>
                  {days.map((d) => (
                    <td key={d} className="p-2 align-middle">
                      <div className="relative h-6 rounded bg-black/5 overflow-hidden" title="0h — 24h">
                        <div className="absolute inset-y-0 left-1/4 w-px bg-black/10" /><div className="absolute inset-y-0 left-1/2 w-px bg-black/15" /><div className="absolute inset-y-0 left-3/4 w-px bg-black/10" />
                        {r.blocks.map((b: any, i: number) => { const s = seg(b, d); return s && <div key={i} className={`absolute inset-y-0 ${prioBar(r.priority)}`} style={{ left: `${s.left}%`, width: `${s.width}%` }} title={`${fmtLocal(b.start)} → ${fmtLocal(b.end)}`} />; })}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-cinza p-3">Cada célula vai de 0h a 24h (linhas em 6h, 12h e 18h). Quando duas barras se sobrepõem, vale a regra mais forte.</p>
        </Card>
      )}
    </div>
  );
}
