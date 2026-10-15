import { useState } from 'react';
import { get, post, patch } from '../api.ts';
import { Button, Card, PageHeader, Field, Input, Select, Toggle, Badge, Empty, Loading, ErrorBox, Modal, Thumb, useLoad, useAction, useConfirm, TIMEZONES } from '../ui.tsx';
import { useMe, can } from '../App.tsx';

const blank = { name: '', address: '', city: '', state: 'SP', timezone: 'America/Sao_Paulo', contact_name: '', contact_phone: '', contact_email: '', image_media_id: null as string | null, active: true };

export default function Units() {
  const me = useMe();
  const [archived, setArchived] = useState(false);
  const { data, error, loading, reload } = useLoad(() => get(`/api/units${archived ? '?archived=1' : ''}`), [archived]);
  const [open, setOpen] = useState<any>(null);
  return (
    <>
      <PageHeader title="Unidades" mark="POP" sub="Restaurantes, ambientes e telas. Nada disso fica fixo no código: cadastre novas unidades aqui."
        actions={can.admin(me) && <Button size="lg" onClick={() => setOpen({ ...blank })}>+ Nova unidade</Button>} />
      <div className="mb-4"><Toggle checked={archived} onChange={setArchived} label="Mostrar unidades arquivadas" /></div>
      {error && <ErrorBox msg={error} />}
      {loading && !data ? <Loading /> : !data?.length ? <Empty title="Nenhuma unidade" text="Cadastre a primeira unidade para começar a organizar as telas." /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((u: any) => (
            <button key={u.id} onClick={() => setOpen(u)} className="text-left block h-full">
              <Card className="overflow-hidden hover:-translate-y-0.5 transition h-full">
                <div className="relative">
                  <Thumb url={u.image_url} corner className="aspect-[16/7]" />
                  <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/85 to-transparent">
                    <p className="text-white text-2xl font-black leading-none">{u.name}</p>
                    <p className="text-white/80 text-xs font-semibold mt-1">{[u.city, u.state].filter(Boolean).join(' / ') || 'Sem cidade'}</p>
                  </div>
                </div>
                <div className="p-4 flex flex-wrap items-center gap-2">
                  {u.archived_at ? <Badge tone="neutro">Arquivada</Badge> : u.active ? <Badge tone="ok">Ativa</Badge> : <Badge tone="pop">Inativa</Badge>}
                  <Badge>{u.environment_count} ambiente(s)</Badge>
                  <Badge>{u.screen_count} tela(s)</Badge>
                  <span className="ml-auto text-xs text-cinza">{u.timezone}</span>
                </div>
                <div className="pop-stripe h-1" />
              </Card>
            </button>
          ))}
        </div>
      )}
      {open && <UnitModal unit={open} units={data ?? []} onClose={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function UnitModal({ unit, units, onClose }: { unit: any; units: any[]; onClose: () => void }) {
  const me = useMe();
  const isNew = !unit.id;
  const admin = can.admin(me);
  const [tab, setTab] = useState<'dados' | 'ambientes' | 'acoes'>('dados');
  const [f, setF] = useState<any>({ ...blank, ...unit });
  const [dup, setDup] = useState({ name: `${unit.name} (cópia)`, copy_environments: true, copy_schedules: true, copy_playlists: false });
  const [picker, setPicker] = useState(false);
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const save = async () => {
    const body = Object.fromEntries(Object.keys(blank).map((k) => [k, f[k]]));
    const r = await run(() => (isNew ? post('/api/units', body) : patch(`/api/units/${unit.id}`, body)), isNew ? 'Unidade criada. Agora crie os ambientes.' : 'Unidade salva.');
    if (r && isNew) { Object.assign(unit, r); setF({ ...f, ...r }); setTab('ambientes'); }
  };
  return (
    <Modal open onClose={onClose} title={isNew ? 'Nova unidade' : unit.name} wide>
      {confirm.node}
      {!isNew && (
        <div className="flex gap-1 border-b border-linha mb-4">
          {([['dados', 'Dados'], ['ambientes', 'Ambientes'], ['acoes', 'Duplicar e arquivar']] as const).map(([k, l]) =>
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm font-bold border-b-4 -mb-px ${tab === k ? 'border-pop' : 'border-transparent text-cinza'}`}>{l}</button>)}
        </div>
      )}
      {tab === 'dados' && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nome da unidade"><Input disabled={!admin} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Consolação" /></Field>
          <Field label="Fuso horário" hint="Os horários das programações seguem este fuso.">
            <Select disabled={!admin} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {TIMEZONES.map((t) => <option key={t} value={t}>{t.replace('America/', '').replace('_', ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Endereço"><Input disabled={!admin} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <Field label="Cidade"><Input disabled={!admin} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <Field label="UF"><Input disabled={!admin} maxLength={2} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} /></Field>
          </div>
          <Field label="Contato (nome)"><Input disabled={!admin} value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
          <Field label="Telefone"><Input disabled={!admin} value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
          <Field label="E-mail"><Input disabled={!admin} type="email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></Field>
          <div className="flex items-end gap-3">
            <Button variant="ghost" disabled={!admin} onClick={() => setPicker(true)}>{f.image_media_id ? 'Trocar imagem' : 'Escolher imagem'}</Button>
            {f.image_media_id && <Button variant="ghost" disabled={!admin} onClick={() => setF({ ...f, image_media_id: null })}>Remover imagem</Button>}
          </div>
          <div className="sm:col-span-2"><Toggle checked={f.active} onChange={(v) => admin && setF({ ...f, active: v })} label={f.active ? 'Unidade ativa' : 'Unidade inativa (TVs mostram só a marca)'} /></div>
          {admin && <div className="sm:col-span-2 flex justify-end"><Button disabled={busy || !f.name} onClick={save}>{isNew ? 'Criar unidade' : 'Salvar alterações'}</Button></div>}
        </div>
      )}
      {tab === 'ambientes' && unit.id && <Environments unitId={unit.id} />}
      {tab === 'acoes' && unit.id && (
        <div className="space-y-5">
          <Card className="p-4 space-y-3">
            <p className="font-bold">Criar nova unidade a partir desta</p>
            <Field label="Nome da nova unidade"><Input value={dup.name} onChange={(e) => setDup({ ...dup, name: e.target.value })} /></Field>
            <div className="flex flex-col gap-2">
              <Toggle checked={dup.copy_environments} onChange={(v) => setDup({ ...dup, copy_environments: v })} label="Copiar ambientes" />
              <Toggle checked={dup.copy_schedules} onChange={(v) => setDup({ ...dup, copy_schedules: v })} label="Copiar programações da unidade" />
              <Toggle checked={dup.copy_playlists} onChange={(v) => setDup({ ...dup, copy_playlists: v })} label="Criar cópias das playlists (em vez de compartilhar as mesmas)" />
            </div>
            <Button disabled={!admin || busy || !dup.name} onClick={() => run(() => post(`/api/units/${unit.id}/duplicate`, dup), 'Unidade duplicada.').then((r) => r && onClose())}>Duplicar unidade</Button>
          </Card>
          <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-bold">{unit.archived_at ? 'Desarquivar' : 'Arquivar'} unidade</p><p className="text-sm text-cinza">Arquivar tira a unidade das listas e para suas TVs, mas mantém todo o histórico.</p></div>
            <Button variant="danger" disabled={!admin} onClick={async () => {
              const a = unit.archived_at ? 'unarchive' : 'archive';
              if (a === 'unarchive' || await confirm.ask('Arquivar unidade?', `As TVs de "${unit.name}" passam a mostrar só a marca POP.`, 'Arquivar')) run(() => post(`/api/units/${unit.id}/${a}`), a === 'archive' ? 'Unidade arquivada.' : 'Unidade reativada.').then(onClose);
            }}>{unit.archived_at ? 'Desarquivar' : 'Arquivar'}</Button>
          </Card>
          <p className="text-xs text-cinza">Unidades existentes: {units.length}. Não existe exclusão definitiva de unidade, para não perder histórico.</p>
        </div>
      )}
      {picker && <ImagePicker onPick={(id) => { setF({ ...f, image_media_id: id }); setPicker(false); }} onClose={() => setPicker(false)} />}
    </Modal>
  );
}

function ImagePicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const { data } = useLoad(() => get('/api/media?kind=image'));
  return (
    <Modal open onClose={onClose} title="Escolher imagem da biblioteca" wide>
      {!data?.length ? <Empty title="Sem imagens" text="Envie imagens na Biblioteca de mídia." /> : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {data.map((m: any) => <button key={m.id} onClick={() => onPick(m.id)} className="text-left"><Thumb url={m.thumb_url} className="aspect-video rounded-lg" /><p className="text-xs font-semibold mt-1 truncate">{m.name}</p></button>)}
        </div>
      )}
    </Modal>
  );
}

function Environments({ unitId }: { unitId: string }) {
  const me = useMe();
  const editable = can.screens(me, unitId);
  const { data, reload } = useLoad(() => get(`/api/units/${unitId}/environments?archived=1`), [unitId]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const { run, busy } = useAction();
  const live = data?.filter((e: any) => !e.archived_at) ?? [];
  const move = (i: number, d: number) => {
    const ids = live.map((e: any) => e.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    run(() => post(`/api/units/${unitId}/environments/reorder`, { ids })).then(reload);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-cinza">Espaços onde ficam as TVs (Salão, Entrada, Caixa, Área externa…). Use as setas para reordenar.</p>
      {data?.map((e: any) => {
        const i = live.indexOf(e);
        return (
          <div key={e.id} className={`flex items-center gap-2 p-2 rounded-xl border border-linha ${e.archived_at ? 'opacity-55' : ''}`}>
            {editing && editing.id === e.id ? (
              <>
                <Input value={editing.name} onChange={(x) => setEditing({ id: e.id, name: x.target.value })} autoFocus />
                <Button size="sm" onClick={() => run(() => patch(`/api/environments/${e.id}`, { name: editing.name }), 'Ambiente renomeado.').then(() => { setEditing(null); reload(); })}>Salvar</Button>
              </>
            ) : (
              <>
                <span className="font-bold flex-1">{e.name} <span className="text-xs text-cinza font-semibold">· {e.screen_count} tela(s){e.archived_at ? ' · arquivado' : ''}</span></span>
                {editable && !e.archived_at && <>
                  <Button size="sm" variant="ghost" aria-label="Subir" disabled={i <= 0} onClick={() => move(i, -1)}>↑</Button>
                  <Button size="sm" variant="ghost" aria-label="Descer" disabled={i >= live.length - 1} onClick={() => move(i, 1)}>↓</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ id: e.id, name: e.name })}>Renomear</Button>
                </>}
                {editable && <Button size="sm" variant="ghost" onClick={() => run(() => patch(`/api/environments/${e.id}`, { archived: !e.archived_at })).then(reload)}>{e.archived_at ? 'Reativar' : 'Arquivar'}</Button>}
              </>
            )}
          </div>
        );
      })}
      {editable && (
        <form className="flex gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); run(() => post(`/api/units/${unitId}/environments`, { name }), 'Ambiente criado.').then(() => { setName(''); reload(); }); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Novo ambiente (ex.: Área externa)" />
          <Button type="submit" disabled={busy || !name}>Adicionar</Button>
        </form>
      )}
    </div>
  );
}
