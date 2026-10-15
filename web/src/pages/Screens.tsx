import { useEffect, useMemo, useState } from 'react';
import { get, post, patch, put, del } from '../api.ts';
import {
  Button, Card, PageHeader, Field, Input, Select, Toggle, Badge, StatusPill, Empty, Loading, ErrorBox, Modal, Thumb,
  useLoad, useAction, useConfirm, ago, fmtDate, fmtLocal,
} from '../ui.tsx';
import { useMe, can } from '../App.tsx';
import { PreviewModal } from '../Preview.tsx';

export type Screen = any;

const SOURCE_LABEL: Record<string, string> = { regra: '', segurança: 'Playlist de segurança', nenhuma: 'Tela da marca (sem conteúdo)', desativada: 'Desativada' };

// ---------------- Card de TV (moldura de TV, usado no início e em Telas) ----------------
export function TvCard({ s, onManage, onPreview, onSwitch }: { s: Screen; onManage: () => void; onPreview: () => void; onSwitch: () => void }) {
  const me = useMe();
  const d = s.decision;
  const portrait = s.orientation === 'portrait';
  return (
    <Card className="p-3 flex flex-col animate-rise">
      <div className="rounded-xl bg-preto p-2 pb-3 relative">
        <Thumb url={d?.playlist?.first?.thumb_url} kind={d?.playlist?.first?.kind} className={`rounded-md ${portrait ? 'aspect-[9/16] w-1/2 mx-auto' : 'aspect-video'}`} />
        <div className="absolute top-3.5 left-3.5">
          {s.paired ? (s.online ? <span className="bg-ok text-white text-[10px] font-black px-2 py-1 rounded-full tracking-wider">● NO AR</span>
            : <span className="bg-pop text-white text-[10px] font-black px-2 py-1 rounded-full tracking-wider">OFFLINE</span>)
            : <span className="bg-laranja text-preto text-[10px] font-black px-2 py-1 rounded-full tracking-wider">SEM PAREAMENTO</span>}
        </div>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" />
      </div>
      <div className="pt-3 px-1 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-black leading-tight">{s.name}</p>
          {!s.active && <Badge tone="neutro">Desativada</Badge>}
        </div>
        <p className="text-xs text-cinza font-semibold">{s.unit_name}{s.environment_name ? ` · ${s.environment_name}` : ''}</p>
        <p className="text-sm mt-2 truncate">
          <span className="text-cinza">Programação: </span>
          <b>{d?.playlist ? `${d.playlist.name} (v${d.playlist.version})` : SOURCE_LABEL[d?.source] || '—'}</b>
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
          <span className="text-cinza">Último contato {ago(s.last_seen_at)}</span>
          {s.paired && (s.in_sync ? <Badge tone="ok">TV confirmou</Badge> : s.online ? <Badge tone="laranja">Aguardando TV</Badge> : <Badge tone="neutro">Não confirmado</Badge>)}
          {s.last_error && <Badge tone="pop">Erro recente</Badge>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-3 mt-auto">
        <Button size="sm" variant="dark" onClick={onManage}>Gerenciar</Button>
        <Button size="sm" variant="ghost" onClick={onPreview}>Pré-visualizar</Button>
        {can.publish(me) && <Button size="sm" variant="ghost" onClick={onSwitch}>Trocar programação</Button>}
      </div>
    </Card>
  );
}

/** Cards + modais ligados (gerenciar, simular, trocar), para reuso */
export function TvWall({ screens, reload, groupBy = true }: { screens: Screen[]; reload: () => void; groupBy?: boolean }) {
  const [manage, setManage] = useState<Screen | null>(null);
  const [preview, setPreview] = useState<Screen | null>(null);
  const [sw, setSw] = useState<Screen | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, Screen[]>();
    for (const s of screens) {
      const k = groupBy ? `${s.unit_name}|${s.environment_name ?? 'Sem ambiente'}` : 'Todas';
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [screens, groupBy]);
  return (
    <>
      <div className="space-y-8">
        {groups.map(([k, list]) => {
          const [unit, env] = k.split('|');
          return (
            <section key={k}>
              {groupBy && <h3 className="text-sm font-black uppercase tracking-wider mb-3"><span className="text-pop">{unit}</span> <span className="text-cinza">/ {env}</span></h3>}
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {list.map((s) => <TvCard key={s.id} s={s} onManage={() => setManage(s)} onPreview={() => setPreview(s)} onSwitch={() => setSw(s)} />)}
              </div>
            </section>
          );
        })}
      </div>
      {manage && <ManageScreen screen={manage} onClose={() => { setManage(null); reload(); }} />}
      {preview && <ScreenPreview screen={preview} onClose={() => setPreview(null)} />}
      {sw && <SwitchProgram screen={sw} onClose={(changed) => { setSw(null); if (changed) reload(); }} />}
    </>
  );
}

export function ScreenPreview({ screen, onClose, at }: { screen: Screen; onClose: () => void; at?: string }) {
  const { data } = useLoad(() => get(`/api/screens/${screen.id}/resolve${at ? `?at=${encodeURIComponent(at)}` : ''}`), [screen.id, at]);
  return (
    <PreviewModal open onClose={onClose} items={data?.items ?? []} playlistName={data?.playlist ? `${data.playlist.name} v${data.playlist.version}` : undefined}
      screenName={screen.name} orientation={screen.orientation}
      note={data ? `${data.explanation} (hora local da unidade: ${fmtLocal(data.local_time)})` : 'Carregando…'} />
  );
}

// ---------------- Trocar programação (regra "Padrão" desta tela ou campanha temporária) ----------------
function SwitchProgram({ screen, onClose }: { screen: Screen; onClose: (changed: boolean) => void }) {
  const { data: playlists } = useLoad(() => get('/api/playlists'));
  const { data: rules } = useLoad(() => get('/api/schedules'));
  const [pid, setPid] = useState('');
  const [mode, setMode] = useState<'base' | 'temp'>('base');
  const [until, setUntil] = useState('');
  const { run, busy } = useAction();
  const base = rules?.find((r: any) => r.target_type === 'screen' && r.target_id === screen.id && r.priority === 10 && !r.start_at && !r.end_at && !r.time_start);
  useEffect(() => { if (base) setPid(base.playlist_id); }, [base]);
  async function save() {
    const ok = await run(async () => {
      if (mode === 'base') {
        if (base) await patch(`/api/schedules/${base.id}`, { playlist_id: pid });
        else await post('/api/schedules', { name: `Padrão — ${screen.name}`, playlist_id: pid, target_type: 'screen', target_id: screen.id, priority: 10 });
      } else {
        const now = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
        const start = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        await post('/api/schedules', { name: `Temporária — ${screen.name}`, playlist_id: pid, target_type: 'screen', target_id: screen.id, priority: 50, start_at: start, end_at: until.replace('T', ' ') });
      }
      return true;
    }, 'Programação publicada. A TV troca na próxima sincronização (até 30 s).');
    if (ok) onClose(true);
  }
  const unpublished = playlists?.find((p: any) => p.id === pid && !p.published_version);
  return (
    <Modal open onClose={() => onClose(false)} title={`Trocar programação · ${screen.name}`}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button disabled={!pid || busy || (mode === 'temp' && !until)} onClick={save}>Publicar nesta tela</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {([['base', 'Programação fixa', 'Fica até você trocar de novo.'], ['temp', 'Campanha temporária', 'Volta sozinha à anterior.']] as const).map(([k, t, d]) => (
            <button key={k} onClick={() => setMode(k)} className={`text-left rounded-xl border-2 p-3 ${mode === k ? 'border-pop bg-pop-soft' : 'border-linha'}`}>
              <p className="font-bold text-sm">{t}</p><p className="text-xs text-cinza">{d}</p>
            </button>
          ))}
        </div>
        <Field label="Playlist">
          <Select value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">Escolha…</option>
            {playlists?.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.published_version ? ` (v${p.published_version})` : ' — não publicada'}</option>)}
          </Select>
        </Field>
        {unpublished && <p className="text-xs font-semibold text-laranja-ink bg-laranja-soft rounded-lg p-2">Esta playlist ainda não foi publicada: a TV continua com a programação atual até você publicá-la.</p>}
        {mode === 'temp' && <Field label="Termina em (hora local da unidade)"><Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>}
        <p className="text-xs text-cinza">Regras com prioridade maior (campanhas e emergências) continuam valendo por cima desta.</p>
      </div>
    </Modal>
  );
}

// ---------------- Gerenciar tela ----------------
function ManageScreen({ screen, onClose }: { screen: Screen; onClose: () => void }) {
  const me = useMe();
  const editable = can.screens(me, screen.unit_id);
  const [tab, setTab] = useState<'dados' | 'agora' | 'diag' | 'acoes'>('dados');
  const { data: s, reload } = useLoad(() => get(`/api/screens/${screen.id}`), [screen.id]);
  const { data: envs } = useLoad(() => get(`/api/units/${screen.unit_id}/environments`), [screen.unit_id]);
  const { data: groups } = useLoad(() => get('/api/groups'));
  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (s && !form) setForm({ name: s.name, environment_id: s.environment_id, manufacturer: s.manufacturer, model: s.model, orientation: s.orientation, active: s.active, group_ids: s.group_ids }); }, [s, form]);
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [code, setCode] = useState('');
  const [at, setAt] = useState('');
  const { data: why } = useLoad(() => get(`/api/screens/${screen.id}/resolve${at ? `?at=${encodeURIComponent(at)}` : ''}`), [screen.id, at]);
  const { data: logs } = useLoad(() => get(`/api/screens/${screen.id}/logs`), [screen.id]);
  if (!s || !form) return <Modal open onClose={onClose} title={screen.name}><Loading /></Modal>;
  const tabs = [['dados', 'Dados'], ['agora', 'O que está tocando'], ['diag', 'Diagnóstico'], ['acoes', 'Pareamento e acesso']] as const;
  const caps = s.capabilities || {};
  return (
    <Modal open onClose={onClose} title={s.name} wide>
      {confirm.node}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <StatusPill online={s.online} paired={s.paired} />
        <span className="text-xs text-cinza">Último contato {ago(s.last_seen_at)} · {s.unit_name}{s.environment_name ? ` / ${s.environment_name}` : ''}</span>
      </div>
      <div className="flex gap-1 border-b border-linha mb-4 overflow-x-auto">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm font-bold whitespace-nowrap border-b-4 -mb-px ${tab === k ? 'border-pop text-tinta' : 'border-transparent text-cinza'}`}>{l}</button>)}
      </div>

      {tab === 'dados' && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nome da TV"><Input disabled={!editable} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Ambiente">
            <Select disabled={!editable} value={form.environment_id ?? ''} onChange={(e) => setForm({ ...form, environment_id: e.target.value || null })}>
              <option value="">Sem ambiente</option>
              {envs?.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          <Field label="Fabricante"><Input disabled={!editable} placeholder="Ex.: Samsung" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></Field>
          <Field label="Modelo"><Input disabled={!editable} placeholder="Ex.: UN43T5300" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
          <Field label="Orientação">
            <Select disabled={!editable} value={form.orientation} onChange={(e) => setForm({ ...form, orientation: e.target.value })}>
              <option value="landscape">Horizontal (16:9)</option><option value="portrait">Vertical (9:16)</option>
            </Select>
          </Field>
          <div className="flex items-end pb-2"><Toggle checked={form.active} onChange={(v) => editable && setForm({ ...form, active: v })} label={form.active ? 'Tela ativa' : 'Tela desativada (mostra só a marca)'} /></div>
          <div className="sm:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-cinza mb-2">Grupos</p>
            <div className="flex flex-wrap gap-2">
              {groups?.filter((g: any) => !g.unit_id || g.unit_id === s.unit_id).map((g: any) => {
                const on = form.group_ids.includes(g.id);
                return <button key={g.id} disabled={!editable} onClick={() => setForm({ ...form, group_ids: on ? form.group_ids.filter((x: string) => x !== g.id) : [...form.group_ids, g.id] })}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 ${on ? 'bg-preto text-white border-preto' : 'border-linha'}`}>{g.name}{!g.unit_id && ' (entre unidades)'}</button>;
              })}
              {!groups?.length && <span className="text-sm text-cinza">Nenhum grupo criado ainda.</span>}
            </div>
          </div>
          {editable && <div className="sm:col-span-2 flex justify-end"><Button disabled={busy} onClick={() => run(() => patch(`/api/screens/${s.id}`, form), 'Tela atualizada.').then(reload)}>Salvar alterações</Button></div>}
        </div>
      )}

      {tab === 'agora' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Simular outro horário (hora local da unidade)"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
            {at && <Button variant="ghost" onClick={() => setAt('')}>Voltar para agora</Button>}
          </div>
          {why && (
            <Card className="p-4 border-l-8 border-l-pop">
              <p className="text-xs font-bold uppercase tracking-wider text-cinza">Regra que decide o conteúdo · {fmtLocal(why.local_time)}</p>
              <p className="font-black text-lg mt-1">{why.rule ? why.rule.name : SOURCE_LABEL[why.source]}</p>
              <p className="text-sm mt-1">{why.explanation}</p>
              {why.playlist && <p className="text-sm mt-2">Playlist: <b>{why.playlist.name}</b> (versão {why.playlist.version}, {why.items.length} itens)</p>}
              {!!why.overridden.length && (
                <div className="mt-3">
                  <p className="text-xs font-bold text-cinza uppercase">Também ativas, mas com menos força:</p>
                  <ul className="text-sm list-disc ml-5">{why.overridden.map((r: any) => <li key={r.id}>{r.name} ({r.priority_label}, alvo: {({ all: 'todas', unit: 'unidade', group: 'grupo', screen: 'esta TV' } as Record<string, string>)[r.target_type]})</li>)}</ul>
                </div>
              )}
            </Card>
          )}
          <p className="text-xs text-cinza">"Publicado" significa que o servidor já tem a versão; a coluna Diagnóstico mostra se a TV confirmou que está tocando.</p>
        </div>
      )}

      {tab === 'diag' && (
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <Card className="p-4 space-y-1.5">
            <p><b>Última sincronização:</b> {fmtDate(s.last_sync_at)}</p>
            <p><b>Estado informado pela TV:</b> {s.playback_state || '—'}</p>
            <p><b>Item em exibição:</b> {s.current_item || '—'}</p>
            <p><b>Versão confirmada pela TV:</b> {s.reported_version || '—'} {s.in_sync ? <Badge tone="ok">igual à publicada</Badge> : <Badge tone="laranja">diferente da publicada</Badge>}</p>
            <p><b>IP:</b> {s.last_ip || '—'}</p>
            <p className="break-all"><b>Navegador:</b> {s.user_agent || '—'}</p>
            <p><b>Último erro:</b> {s.last_error ? `${s.last_error} (${fmtDate(s.last_error_at)})` : 'nenhum'}</p>
          </Card>
          <Card className="p-4">
            <p className="font-bold mb-2">Capacidades detectadas no navegador da TV</p>
            {!s.capabilities ? <p className="text-cinza">A TV ainda não informou.</p> : (
              <ul className="space-y-1">
                {[
                  ['Vídeo MP4/H.264', caps.h264 !== 'no'], ['Cache offline (Service Worker)', caps.offlineCache], ['Service Worker ativo', caps.swActive],
                  ['Armazenamento local', caps.localStorage], ['Tela cheia', caps.fullscreen], ['WebP', caps.webp], ['Conexão segura (HTTPS)', caps.secure],
                ].map(([l, ok]) => <li key={l as string} className="flex justify-between"><span>{l}</span>{ok ? <Badge tone="ok">sim</Badge> : <Badge tone="pop">não</Badge>}</li>)}
                <li className="text-xs text-cinza pt-1">Tela {caps.screen} · janela {caps.viewport}</li>
              </ul>
            )}
            {s.capabilities && !caps.minimumOk && <p className="mt-3 text-xs font-semibold bg-laranja-soft text-laranja-ink p-2 rounded-lg">Este navegador não toca MP4/H.264. Use só imagens ou um player externo (Android TV box / Google TV).</p>}
            {s.capabilities && caps.minimumOk && !caps.offlineCache && <p className="mt-3 text-xs font-semibold bg-laranja-soft text-laranja-ink p-2 rounded-lg">Sem cache offline: se a internet cair e a TV recarregar a página, o conteúdo não volta até a conexão voltar.</p>}
          </Card>
          <Card className="p-4 md:col-span-2">
            <p className="font-bold mb-2">Registro de erros (30 dias)</p>
            {!logs?.length ? <p className="text-cinza">Nenhum erro registrado.</p> :
              <ul className="space-y-1 max-h-48 overflow-y-auto">{logs.map((l: any, i: number) => <li key={i} className="text-xs"><span className="text-cinza">{fmtDate(l.created_at)}</span> — {l.message}</li>)}</ul>}
          </Card>
        </div>
      )}

      {tab === 'acoes' && (
        <div className="space-y-5">
          {!editable && <ErrorBox msg="Você pode ver esta tela, mas não tem permissão para alterar o pareamento." />}
          <Card className="p-4">
            <p className="font-bold">Refazer pareamento</p>
            <p className="text-sm text-cinza mb-3">Abra o player na TV (ou em outra TV que vai substituir esta), veja o código e digite aqui. A credencial antiga é revogada.</p>
            <div className="flex gap-2">
              <Input disabled={!editable} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ex.: ABC234" className="max-w-[200px] font-black tracking-[.3em] text-lg!" />
              <Button disabled={!editable || code.length < 6 || busy} onClick={() => run(() => post(`/api/screens/${s.id}/repair`, { code }), 'Pareamento refeito.').then(() => { setCode(''); reload(); })}>Parear</Button>
            </div>
          </Card>
          <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-bold">Revogar acesso</p><p className="text-sm text-cinza">A TV para de receber conteúdo e volta para a tela de código.</p></div>
            <Button variant="danger" disabled={!editable || !s.paired} onClick={async () => {
              if (await confirm.ask('Revogar acesso?', `A TV "${s.name}" deixará de exibir a programação até ser pareada de novo.`, 'Revogar')) run(() => post(`/api/screens/${s.id}/revoke`), 'Acesso revogado.').then(reload);
            }}>Revogar</Button>
          </Card>
          <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-bold">Remover tela</p><p className="text-sm text-cinza">Apaga o cadastro e as programações específicas desta TV. O histórico continua registrado.</p></div>
            <Button variant="danger" disabled={!editable} onClick={async () => {
              if (await confirm.ask('Remover esta tela?', `"${s.name}" será removida. Isso não pode ser desfeito.`, 'Remover definitivamente')) { const r = await run(() => del(`/api/screens/${s.id}`), 'Tela removida.'); if (r) onClose(); }
            }}>Remover</Button>
          </Card>
        </div>
      )}
    </Modal>
  );
}

// ---------------- Adicionar tela (pareamento) ----------------
export function PairModal({ open, onClose, defaultUnit }: { open: boolean; onClose: (paired: boolean) => void; defaultUnit?: string }) {
  const me = useMe();
  const { data: units } = useLoad(() => get('/api/units'));
  const { data: playlists } = useLoad(() => get('/api/playlists'));
  const [f, setF] = useState<any>({ code: '', unit_id: defaultUnit ?? '', environment_id: '', name: '', manufacturer: '', model: '', orientation: 'landscape', playlist_id: '' });
  const { data: envs } = useLoad(() => (f.unit_id ? get(`/api/units/${f.unit_id}/environments`) : Promise.resolve([])), [f.unit_id]);
  const [done, setDone] = useState<any>(null);
  const { run, busy } = useAction();
  useEffect(() => { if (!f.unit_id && units?.length) setF((x: any) => ({ ...x, unit_id: units.find((u: any) => can.screens(me, u.id))?.id ?? '' })); }, [units, f.unit_id, me]);
  const submit = async () => {
    const r = await run(() => post('/api/pairing/claim', { ...f, environment_id: f.environment_id || null, playlist_id: f.playlist_id || null }));
    if (r) setDone(r);
  };
  const close = () => { const p = !!done; setDone(null); setF({ ...f, code: '', name: '' }); onClose(p); };
  return (
    <Modal open={open} onClose={close} title="Adicionar tela"
      footer={done ? <Button onClick={close}>Concluir</Button> : <><Button variant="ghost" onClick={close}>Cancelar</Button><Button disabled={busy || f.code.length < 6 || !f.unit_id || !f.name} onClick={submit}>Parear e ativar</Button></>}>
      {done ? (
        <div className="text-center py-6">
          <div className="w-16 h-16 rounded-full bg-ok text-white text-3xl grid place-items-center mx-auto mb-3">✓</div>
          <p className="font-black text-xl">"{done.name}" pareada!</p>
          <p className="text-sm text-cinza mt-1">A TV sai da tela de código em alguns segundos e começa a tocar a programação.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-preto text-white p-4 text-sm">
            <p className="font-bold text-laranja text-xs tracking-widest uppercase mb-1">Na TV</p>
            Abra o navegador da TV no endereço <b className="break-all">{location.origin}/tv</b>. Um código de 6 letras aparece na tela.
          </div>
          <Field label="Código mostrado na TV">
            <Input autoFocus value={f.code} maxLength={8} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
              placeholder="ABC234" className="h-16! text-3xl! font-black tracking-[.4em] text-center" />
          </Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Unidade">
              <Select value={f.unit_id} onChange={(e) => setF({ ...f, unit_id: e.target.value, environment_id: '' })}>
                {units?.filter((u: any) => can.screens(me, u.id)).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Ambiente">
              <Select value={f.environment_id} onChange={(e) => setF({ ...f, environment_id: e.target.value })}>
                <option value="">Sem ambiente</option>
                {envs?.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Nome da TV"><Input value={f.name} placeholder="Ex.: TV 01 — Salão" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Orientação">
              <Select value={f.orientation} onChange={(e) => setF({ ...f, orientation: e.target.value })}>
                <option value="landscape">Horizontal (16:9)</option><option value="portrait">Vertical (9:16)</option>
              </Select>
            </Field>
            <Field label="Fabricante (opcional)"><Input value={f.manufacturer} placeholder="Samsung, LG…" onChange={(e) => setF({ ...f, manufacturer: e.target.value })} /></Field>
            <Field label="Modelo (opcional)"><Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
          </div>
          {can.publish(me) && (
            <Field label="Playlist inicial (opcional)" hint="Sem playlist, a TV toca as regras da unidade ou a playlist de segurança.">
              <Select value={f.playlist_id} onChange={(e) => setF({ ...f, playlist_id: e.target.value })}>
                <option value="">Usar as regras da unidade</option>
                {playlists?.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.published_version ? '' : ' — não publicada'}</option>)}
              </Select>
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------------- Página Telas ----------------
export default function Screens() {
  const me = useMe();
  const [unit, setUnit] = useState('');
  const { data, error, loading, reload } = useLoad(() => get(`/api/screens${unit ? `?unit_id=${unit}` : ''}`), [unit]);
  const { data: units } = useLoad(() => get('/api/units'));
  const [pair, setPair] = useState(false);
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  const canAdd = units?.some((u: any) => can.screens(me, u.id));
  return (
    <>
      <PageHeader title="Telas" mark="do POP" sub="Cada card é uma TV real. O status vem da própria TV a cada sincronização."
        actions={canAdd && <Button size="lg" onClick={() => setPair(true)}>+ Adicionar tela</Button>} />
      <div className="flex flex-wrap gap-2 mb-6">
        <Button size="sm" variant={!unit ? 'dark' : 'ghost'} onClick={() => setUnit('')}>Todas</Button>
        {units?.map((u: any) => <Button key={u.id} size="sm" variant={unit === u.id ? 'dark' : 'ghost'} onClick={() => setUnit(u.id)}>{u.name}</Button>)}
      </div>
      {error && <ErrorBox msg={error} />}
      {loading && !data ? <Loading /> : data?.length ? <TvWall screens={data} reload={reload} /> :
        <Empty title="Nenhuma tela por aqui" text="Abra o player no navegador da TV e pareie com o código que aparecer." action={canAdd && <Button onClick={() => setPair(true)}>+ Adicionar tela</Button>} />}
      <Groups screens={data ?? []} units={units ?? []} />
      <PairModal open={pair} onClose={(p) => { setPair(false); if (p) reload(); }} defaultUnit={unit || undefined} />
    </>
  );
}

function Groups({ screens, units }: { screens: Screen[]; units: any[] }) {
  const me = useMe();
  const { data: groups, reload } = useLoad(() => get('/api/groups'));
  const [edit, setEdit] = useState<any>(null);
  const [members, setMembers] = useState<string[]>([]);
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const editable = (g: any) => (g.unit_id ? can.screens(me, g.unit_id) : can.admin(me));
  const open = (g: any) => { setEdit(g); setMembers(g.screen_ids ?? []); };
  async function save() {
    const ok = await run(async () => {
      const g = edit.id ? edit : await post('/api/groups', { name: edit.name, description: edit.description, unit_id: edit.unit_id || null });
      if (edit.id) await patch(`/api/groups/${g.id}`, { name: edit.name, description: edit.description });
      await put(`/api/groups/${g.id}/members`, { screen_ids: members });
      return true;
    }, 'Grupo salvo.');
    if (ok) { setEdit(null); reload(); }
  }
  const pool = screens.filter((s) => !edit?.unit_id || s.unit_id === edit.unit_id);
  return (
    <section className="mt-12">
      {confirm.node}
      <div className="flex items-end justify-between mb-3">
        <div><h2 className="text-2xl font-black">Grupos de telas</h2><p className="text-sm text-cinza">Publique para várias TVs de uma vez — dentro de uma unidade ou entre unidades.</p></div>
        {(can.admin(me) || units.some((u) => can.screens(me, u.id))) && <Button variant="dark" onClick={() => open({ name: '', description: '', unit_id: can.admin(me) ? '' : units.find((u) => can.screens(me, u.id))?.id })}>+ Novo grupo</Button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups?.map((g: any) => (
          <Card key={g.id} className="p-4">
            <div className="flex justify-between gap-2">
              <div><p className="font-black">{g.name}</p><p className="text-xs text-cinza">{g.unit_name ?? 'Entre unidades'} · {g.screen_ids.length} tela(s)</p></div>
              {editable(g) && <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => open(g)}>Editar</Button>
                <Button size="sm" variant="ghost" onClick={async () => { if (await confirm.ask('Remover grupo?', `As programações publicadas para "${g.name}" também serão removidas.`, 'Remover')) run(() => del(`/api/groups/${g.id}`), 'Grupo removido.').then(reload); }}>Remover</Button>
              </div>}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">{g.screen_ids.map((id: string) => <Badge key={id}>{screens.find((s) => s.id === id)?.name ?? 'TV'}</Badge>)}</div>
          </Card>
        ))}
        {!groups?.length && <p className="text-sm text-cinza">Nenhum grupo ainda.</p>}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar grupo' : 'Novo grupo'}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button disabled={busy || !edit?.name} onClick={save}>Salvar grupo</Button></>}>
        {edit && (
          <div className="space-y-4">
            <Field label="Nome"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ex.: TVs do salão" /></Field>
            {!edit.id && (
              <Field label="Abrangência">
                <Select value={edit.unit_id ?? ''} onChange={(e) => { setEdit({ ...edit, unit_id: e.target.value }); setMembers([]); }}>
                  {can.admin(me) && <option value="">Entre unidades</option>}
                  {units.filter((u) => can.screens(me, u.id)).map((u) => <option key={u.id} value={u.id}>Só {u.name}</option>)}
                </Select>
              </Field>
            )}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-cinza mb-2">Telas do grupo</p>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {pool.map((s) => (
                  <label key={s.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-fundo text-sm">
                    <input type="checkbox" checked={members.includes(s.id)} onChange={(e) => setMembers(e.target.checked ? [...members, s.id] : members.filter((x) => x !== s.id))} />
                    <b>{s.name}</b> <span className="text-cinza">{s.unit_name} / {s.environment_name ?? '—'}</span>
                  </label>
                ))}
                {!pool.length && <p className="text-sm text-cinza">Nenhuma tela disponível.</p>}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
