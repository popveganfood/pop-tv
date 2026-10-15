import { useEffect, useState } from 'react';
import { get, post, put, patch, del } from '../api.ts';
import {
  Button, Card, PageHeader, Field, Input, Select, Badge, Empty, Loading, ErrorBox, Modal, Thumb,
  useLoad, useAction, useConfirm, useRoute, compatBadge, fmtDur, fmtDate, Link,
} from '../ui.tsx';
import { useMe, can } from '../App.tsx';
import { PreviewModal } from '../Preview.tsx';
import { Uploader } from './Media.tsx';

export default function Playlists() {
  const me = useMe();
  const { go } = useRoute();
  const { data, error, loading, reload } = useLoad(() => get('/api/playlists'));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const { run, busy } = useAction();
  const create = async () => { const p = await run(() => post('/api/playlists', { name })); if (p) go(`/playlists/${p.id}`); };
  return (
    <>
      <PageHeader title="Playlists" mark="no ar" sub="Sequências de imagens e vídeos. Edite à vontade: as TVs só mudam quando você publica."
        actions={can.content(me) && <Button size="lg" onClick={() => setCreating(true)}>+ Nova playlist</Button>} />
      {error && <ErrorBox msg={error} />}
      {loading && !data ? <Loading /> : !data?.length ? <Empty title="Nenhuma playlist" /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((p: any) => (
            <Card key={p.id} className="overflow-hidden flex flex-col">
              <Link to={`/playlists/${p.id}`} className="block"><Thumb url={p.cover_url} className="aspect-[16/8]" /></Link>
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/playlists/${p.id}`} className="font-black text-lg leading-tight hover:text-pop">{p.name}</Link>
                  {p.is_fallback && <Badge tone="preto">Segurança</Badge>}
                </div>
                <p className="text-xs text-cinza font-semibold mt-1">{p.item_count} itens · {fmtDur(p.total_ms)} por volta · {p.schedule_count} programação(ões)</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {p.published_version ? <Badge tone="ok">Publicada v{p.published_version}</Badge> : <Badge tone="neutro">Nunca publicada</Badge>}
                  {p.published_version && p.has_unpublished_changes && <Badge tone="laranja">Alterações não publicadas</Badge>}
                </div>
                <div className="flex gap-2 mt-auto pt-4">
                  <Button size="sm" variant="dark" onClick={() => go(`/playlists/${p.id}`)}>Abrir</Button>
                  {can.content(me) && <Button size="sm" variant="ghost" onClick={() => run(() => post(`/api/playlists/${p.id}/duplicate`), 'Playlist duplicada.').then(reload)}>Duplicar</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nova playlist"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><Button disabled={!name || busy} onClick={create}>Criar e editar</Button></>}>
        <Field label="Nome"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Almoço POP — buffet" /></Field>
      </Modal>
    </>
  );
}

type Item = { key: string; media_id: string; name: string; kind: 'image' | 'video'; duration_ms: number | null; thumb_url?: string | null; url?: string | null; compat?: string; media_duration_ms?: number | null };
const PRESETS = [5000, 10000, 15000, 20000];
let seq = 0;
const toItem = (m: any, duration: number | null = null): Item => ({
  key: `i${++seq}`, media_id: m.media_id ?? m.id, name: m.name, kind: m.kind, duration_ms: m.kind === 'image' ? duration ?? m.duration_ms ?? 10000 : null,
  thumb_url: m.thumb_url, url: m.url, compat: m.compat, media_duration_ms: m.media_duration_ms ?? (m.kind === 'video' ? m.duration_ms : null),
});

export function PlaylistEditor({ id }: { id: string }) {
  const me = useMe();
  const { go } = useRoute();
  const editable = can.content(me);
  const { data: p, error, reload } = useLoad(() => get(`/api/playlists/${id}`), [id]);
  const { data: versions, reload: reloadVersions } = useLoad(() => get(`/api/playlists/${id}/versions`), [id]);
  const [items, setItems] = useState<Item[]>([]);
  const [dirty, setDirty] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [meta, setMeta] = useState({ name: '', description: '' });
  const [published, setPublished] = useState<number | null>(null);
  const { run, busy } = useAction();
  const confirm = useConfirm();
  useEffect(() => {
    if (!p) return;
    setItems(p.items.map((it: any) => toItem({ ...it, thumb_url: it.thumb_url, media_duration_ms: it.media_duration_ms }, it.duration_ms)));
    setMeta({ name: p.name, description: p.description });
    setDirty(false);
  }, [p]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    addEventListener('beforeunload', warn); return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
  if (error) return <ErrorBox msg={error} />;
  if (!p) return <Loading />;

  const change = (next: Item[]) => { setItems(next); setDirty(true); };
  const move = (from: number, to: number) => { if (to < 0 || to >= items.length) return; const n = [...items]; const [x] = n.splice(from, 1); n.splice(to, 0, x); change(n); };
  const save = () => run(async () => {
    if (meta.name !== p.name || meta.description !== p.description) await patch(`/api/playlists/${id}`, meta);
    await put(`/api/playlists/${id}/items`, { items: items.map((i) => ({ media_id: i.media_id, duration_ms: i.kind === 'image' ? i.duration_ms : null })) });
    setDirty(false);
    return true;
  }, 'Rascunho salvo. As TVs continuam com a versão publicada.');
  const publish = async () => {
    if (!(await save())) return;
    const r = await run(() => post(`/api/playlists/${id}/publish`), undefined);
    if (r) { reload(); reloadVersions(); setPublished(r.version); }
  };
  const total = items.reduce((s, i) => s + (i.kind === 'image' ? i.duration_ms ?? 10000 : i.media_duration_ms ?? 0), 0);

  return (
    <>
      {confirm.node}
      <div className="mb-4"><Link to="/playlists" className="text-sm font-bold text-cinza hover:text-pop">← Playlists</Link></div>
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <input disabled={!editable} value={meta.name} onChange={(e) => { setMeta({ ...meta, name: e.target.value }); setDirty(true); }}
            className="w-full bg-transparent text-3xl sm:text-4xl font-black tracking-tight focus:outline-none focus:bg-white rounded-lg" aria-label="Nome da playlist" />
          <div className="flex flex-wrap gap-2 mt-2">
            {p.is_fallback && <Badge tone="preto">Playlist de segurança</Badge>}
            {p.published_version ? <Badge tone="ok">Publicada v{p.published_version} · {fmtDate(p.published_at)}</Badge> : <Badge tone="neutro">Nunca publicada</Badge>}
            {(dirty || (p.published_version && p.has_unpublished_changes)) && <Badge tone="laranja">{dirty ? 'Alterações não salvas' : 'Rascunho diferente do publicado'}</Badge>}
            <Badge>{items.length} itens · {fmtDur(total)} por volta</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setPreview(true)} disabled={!items.length}>Pré-visualizar</Button>
          {editable && <Button variant="dark" disabled={busy || !dirty} onClick={save}>Salvar rascunho</Button>}
          {editable && <Button size="lg" disabled={busy || !items.length} onClick={publish}>Publicar</Button>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          {!items.length ? <Empty title="Playlist vazia" text="Adicione imagens e vídeos da biblioteca ao lado, ou envie arquivos novos." /> : (
            <ol className="space-y-2">
              {items.map((it, i) => (
                <li key={it.key} draggable={editable}
                  onDragStart={() => setDrag(i)} onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { move(drag, i); setDrag(i); } }} onDragEnd={() => setDrag(null)}
                  className={`bg-white rounded-pop border border-black/5 shadow-card p-2 flex items-center gap-3 ${drag === i ? 'ring-2 ring-pop opacity-80' : ''}`}>
                  <span className="cursor-grab text-cinza px-1 select-none" aria-hidden>⋮⋮</span>
                  <span className="w-6 text-center font-black text-pop">{i + 1}</span>
                  <Thumb url={it.thumb_url} kind={it.kind} className="w-28 aspect-video rounded-lg shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold truncate">{it.name}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {it.kind === 'image' ? (
                        <DurationPicker disabled={!editable} value={it.duration_ms ?? 10000} onChange={(v) => change(items.map((x) => (x.key === it.key ? { ...x, duration_ms: v } : x)))} />
                      ) : <span className="text-xs font-semibold text-cinza">Vídeo · toca até o fim ({fmtDur(it.media_duration_ms)})</span>}
                      {it.compat && it.compat !== 'ok' && compatBadge(it.compat)}
                    </div>
                  </div>
                  {editable && (
                    <div className="flex flex-wrap justify-end gap-1 max-w-[220px]">
                      <Button size="sm" variant="ghost" aria-label="Subir" onClick={() => move(i, i - 1)} disabled={i === 0}>↑</Button>
                      <Button size="sm" variant="ghost" aria-label="Descer" onClick={() => move(i, i + 1)} disabled={i === items.length - 1}>↓</Button>
                      <Button size="sm" variant="ghost" onClick={() => { const n = [...items]; n.splice(i + 1, 0, { ...it, key: `i${++seq}` }); change(n); }}>Duplicar</Button>
                      <Button size="sm" variant="ghost" onClick={() => change(items.filter((x) => x.key !== it.key))}>Remover</Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}

          <div className="grid gap-4 md:grid-cols-2 mt-8">
            <Card className="p-4">
              <h3 className="font-black mb-2">Versões publicadas</h3>
              {!versions?.length ? <p className="text-sm text-cinza">Ainda não publicada.</p> : (
                <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                  {versions.map((v: any) => (
                    <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                      <span><b>v{v.version}</b> · {v.item_count} itens · {fmtDate(v.created_at)}<br /><span className="text-xs text-cinza">{v.created_by_name ?? '—'}{v.note ? ` · ${v.note}` : ''}</span></span>
                      {v.current ? <Badge tone="ok">Em vigor</Badge> : editable && <Button size="sm" variant="ghost" onClick={async () => {
                        if (await confirm.ask(`Restaurar a versão ${v.version}?`, 'Ela será publicada de novo como uma nova versão e chegará às TVs na próxima sincronização.', 'Restaurar e publicar')) run(() => post(`/api/playlists/${id}/versions/${v.id}/restore`), 'Versão restaurada e publicada.').then(() => { reload(); reloadVersions(); });
                      }}>Restaurar</Button>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-4">
              <h3 className="font-black mb-2">Onde está programada</h3>
              {!p.schedules.length ? <p className="text-sm text-cinza">Nenhuma programação usa esta playlist{p.is_fallback ? ' (mas ela é a de segurança: toca quando nada mais se aplica).' : '. Publique e depois programe em Programação.'}</p> :
                <ul className="text-sm space-y-1">{p.schedules.map((s: any) => <li key={s.id}>▸ {s.name} <span className="text-cinza">({({ all: 'todas as unidades', unit: 'unidade', group: 'grupo', screen: 'uma TV' } as Record<string, string>)[s.target_type]})</span>{!s.enabled && ' — pausada'}</li>)}</ul>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="dark" onClick={() => go('/programacao')}>Programar</Button>
                {editable && !p.is_fallback && <Button size="sm" variant="danger" onClick={async () => {
                  if (await confirm.ask('Excluir playlist?', `"${p.name}" e seu histórico de versões serão apagados.`, 'Excluir')) { const r = await run(() => del(`/api/playlists/${id}`), 'Playlist excluída.'); if (r) go('/playlists'); }
                }}>Excluir playlist</Button>}
              </div>
            </Card>
          </div>
        </section>

        {editable && <LibraryPicker onAdd={(ms) => change([...items, ...ms.map((m) => toItem(m))])} />}
      </div>

      <PreviewModal open={preview} onClose={() => setPreview(false)} items={items.map((i) => ({ ...i, url: i.url ?? i.thumb_url ?? null }))} playlistName={`${meta.name} (rascunho)`} note="Rascunho atual, ainda não publicado." />
      <Modal open={published !== null} onClose={() => setPublished(null)} title="Publicado!" footer={<><Button variant="ghost" onClick={() => setPublished(null)}>Continuar editando</Button><Button onClick={() => go('/telas')}>Ver confirmação das TVs</Button></>}>
        <p className="text-sm">A versão <b>{published}</b> está no servidor. As TVs que exibem esta playlist trocam na próxima sincronização (até 30 s). Em <b>Telas</b>, cada TV mostra "TV confirmou" quando recebe.</p>
        {!p.schedules.length && !p.is_fallback && <p className="text-sm mt-3 font-semibold text-laranja-ink bg-laranja-soft p-2 rounded-lg">Esta playlist ainda não está programada em nenhuma tela. Vá em Programação para escolher onde exibir.</p>}
      </Modal>
    </>
  );
}

function DurationPicker({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const custom = !PRESETS.includes(value);
  return (
    <span className="inline-flex items-center gap-1">
      {PRESETS.map((d) => (
        <button key={d} type="button" disabled={disabled} onClick={() => onChange(d)} className={`h-7 px-2.5 rounded-full text-xs font-bold ${value === d ? 'bg-pop text-white' : 'bg-black/5 hover:bg-black/10'}`}>{d / 1000}s</button>
      ))}
      <label className={`h-7 inline-flex items-center gap-1 px-2 rounded-full text-xs font-bold ${custom ? 'bg-pop text-white' : 'bg-black/5'}`}>
        <input type="number" min={1} max={3600} disabled={disabled} value={custom ? Math.round(value / 1000) : ''} placeholder="outro" onChange={(e) => onChange(Math.max(1, Math.min(3600, Number(e.target.value) || 1)) * 1000)}
          className="w-12 bg-transparent text-right placeholder:text-cinza focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" aria-label="Tempo personalizado em segundos" />s
      </label>
    </span>
  );
}

function LibraryPicker({ onAdd }: { onAdd: (m: any[]) => void }) {
  const [q, setQ] = useState('');
  const [col, setCol] = useState('');
  const query = new URLSearchParams(Object.entries({ q, collection_id: col }).filter(([, v]) => v)).toString();
  const { data, reload } = useLoad(() => get(`/api/media?${query}`), [query]);
  const { data: cols } = useLoad(() => get('/api/collections'));
  return (
    <aside className="space-y-3 xl:sticky xl:top-6 self-start min-w-0">
      <h3 className="font-black text-lg">Biblioteca</h3>
      <div className="flex gap-2">
        <Input placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0" />
        <Select value={col} onChange={(e) => setCol(e.target.value)} className="max-w-[150px] min-w-0"><option value="">Coleções</option>{cols?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </div>
      <div className="grid grid-cols-3 gap-2 max-h-[48vh] overflow-y-auto pr-1">
        {data?.map((m: any) => (
          <button key={m.id} onClick={() => onAdd([m])} className="text-left group" title={`Adicionar ${m.name}`}>
            <div className="relative">
              <Thumb url={m.thumb_url} kind={m.kind} className="aspect-video rounded-lg" />
              <span className="absolute inset-0 rounded-lg bg-pop/80 text-white font-black grid place-items-center opacity-0 group-hover:opacity-100 transition">+ Adicionar</span>
            </div>
            <p className="text-[11px] font-semibold truncate mt-0.5">{m.name}</p>
          </button>
        ))}
        {data && !data.length && <p className="col-span-3 text-sm text-cinza">Nenhum arquivo encontrado.</p>}
      </div>
      <Uploader compact onDone={(assets) => { reload(); onAdd(assets); }} />
    </aside>
  );
}
