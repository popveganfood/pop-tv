import { useRef, useState } from 'react';
import { get, post, patch, del, uploadMedia } from '../api.ts';
import {
  Button, Card, PageHeader, Field, Input, Select, Badge, Empty, Loading, ErrorBox, Modal, Thumb,
  useLoad, useAction, useConfirm, useToast, compatBadge, fmtBytes, fmtDur, fmtDate,
} from '../ui.tsx';
import { useMe, can } from '../App.tsx';

type Up = { name: string; progress: number; status: 'enviando' | 'conferindo' | 'ok' | 'erro'; msg?: string };

/** Área de arrastar e soltar + fila de envios com progresso. Reutilizada no editor de playlist. */
export function Uploader({ collectionId, onDone, compact }: { collectionId?: string | null; onDone: (assets: any[]) => void; compact?: boolean }) {
  const [queue, setQueue] = useState<Up[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  async function send(files: FileList | File[]) {
    const list = [...files];
    const start = queue.length;
    setQueue((q) => [...q, ...list.map((f) => ({ name: f.name, progress: 0, status: 'enviando' as const }))]);
    const set = (i: number, u: Partial<Up>) => setQueue((q) => q.map((x, k) => (k === start + i ? { ...x, ...u } : x)));
    const done: any[] = [];
    // um por vez: não satura a conexão do restaurante
    for (const [i, f] of list.entries()) {
      try {
        const a = await uploadMedia(f, { collection_id: collectionId, onProgress: (p) => set(i, { progress: p, status: p >= 1 ? 'conferindo' : 'enviando' }) });
        set(i, { status: 'ok', progress: 1, msg: a.compat === 'warning' ? a.compat_notes : undefined });
        done.push(a);
      } catch (e: any) { set(i, { status: 'erro', msg: e.message }); }
    }
    if (done.length) { toast('ok', `${done.length} arquivo(s) enviado(s).`); onDone(done); }
  }
  return (
    <div>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) send(e.dataTransfer.files); }}
        className={`rounded-pop border-2 border-dashed text-center transition ${compact ? 'p-4' : 'p-8'} ${over ? 'border-pop bg-pop-soft' : 'border-black/20 bg-white'}`}>
        <p className={`font-black ${compact ? 'text-base' : 'text-xl'}`}>Arraste imagens e vídeos para cá</p>
        <p className="text-xs text-cinza mt-1">JPG, PNG, WebP ou MP4 (H.264). Ideal: 1920×1080 na horizontal ou 1080×1920 na vertical.</p>
        <Button className="mt-3" size={compact ? 'sm' : 'md'} variant="dark" onClick={() => input.current?.click()}>Escolher arquivos</Button>
        <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" className="hidden" onChange={(e) => { if (e.target.files?.length) send(e.target.files); e.target.value = ''; }} />
      </div>
      {!!queue.length && (
        <ul className="mt-3 space-y-1.5">
          {queue.map((u, i) => (
            <li key={i} className="text-sm bg-white rounded-xl border border-linha px-3 py-2">
              <div className="flex justify-between gap-2"><span className="font-semibold truncate">{u.name}</span>
                <span className={`text-xs font-bold ${u.status === 'erro' ? 'text-pop-dark' : u.status === 'ok' ? 'text-ok' : 'text-cinza'}`}>
                  {u.status === 'enviando' ? `${Math.round(u.progress * 100)}%` : u.status === 'conferindo' ? 'conferindo arquivo…' : u.status === 'ok' ? 'pronto' : 'recusado'}</span></div>
              {u.status !== 'ok' && u.status !== 'erro' && <div className="h-1 bg-black/10 rounded-full mt-1.5 overflow-hidden"><div className="h-full bg-pop" style={{ width: `${u.progress * 100}%` }} /></div>}
              {u.msg && <p className={`text-xs mt-1 ${u.status === 'erro' ? 'text-pop-dark' : 'text-laranja-ink'}`}>{u.msg}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Media() {
  const me = useMe();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [col, setCol] = useState('');
  const [tag, setTag] = useState('');
  const query = new URLSearchParams(Object.entries({ q, kind, collection_id: col, tag }).filter(([, v]) => v)).toString();
  const { data, error, loading, reload } = useLoad(() => get(`/api/media?${query}`), [query]);
  const { data: cols, reload: reloadCols } = useLoad(() => get('/api/collections'));
  const [sel, setSel] = useState<any>(null);
  const [manageCols, setManageCols] = useState(false);
  const editable = can.content(me);
  const tags = [...new Set((data ?? []).flatMap((m: any) => m.tags))].sort() as string[];
  return (
    <>
      <PageHeader title="Biblioteca" mark="de mídia" sub="Todos os arquivos usados nas TVs, em um só lugar. Cada envio é conferido pelo servidor (formato real, tamanho, resolução e compatibilidade)."
        actions={editable && <Button variant="ghost" onClick={() => setManageCols(true)}>Coleções</Button>} />
      {editable && <div className="mb-6"><Uploader collectionId={col || null} onDone={() => { reload(); reloadCols(); }} /></div>}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Input placeholder="Buscar por nome ou etiqueta" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="max-w-[160px]"><option value="">Imagens e vídeos</option><option value="image">Só imagens</option><option value="video">Só vídeos</option></Select>
        <Select value={col} onChange={(e) => setCol(e.target.value)} className="max-w-[220px]"><option value="">Todas as coleções</option>{cols?.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.media_count})</option>)}</Select>
        {!!tags.length && <Select value={tag} onChange={(e) => setTag(e.target.value)} className="max-w-[180px]"><option value="">Todas as etiquetas</option>{tags.map((t) => <option key={t}>{t}</option>)}</Select>}
      </div>
      {error && <ErrorBox msg={error} />}
      {loading && !data ? <Loading /> : !data?.length ? <Empty title="Nada por aqui ainda" text="Envie as primeiras imagens e vídeos arrastando para a área acima." /> : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {data.map((m: any) => (
            <button key={m.id} onClick={() => setSel(m)} className="text-left group block h-full">
              <Card className="overflow-hidden group-hover:-translate-y-0.5 transition h-full">
                <Thumb url={m.thumb_url} kind={m.kind} className="aspect-video" alt={m.name} />
                <div className="p-2.5">
                  <p className="text-sm font-bold truncate">{m.name}</p>
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {compatBadge(m.compat)}
                    <span className="text-[11px] text-cinza font-semibold">{m.width}×{m.height}{m.kind === 'video' ? ` · ${fmtDur(m.duration_ms)}` : ''}</span>
                  </div>
                  {m.used_in > 0 && <p className="text-[11px] text-cinza mt-1">Em {m.used_in} playlist(s)</p>}
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
      {sel && <MediaModal m={sel} cols={cols ?? []} onClose={() => { setSel(null); reload(); }} />}
      {manageCols && <Collections cols={cols ?? []} onClose={() => { setManageCols(false); reloadCols(); }} />}
    </>
  );
}

function MediaModal({ m, cols, onClose }: { m: any; cols: any[]; onClose: () => void }) {
  const me = useMe();
  const editable = can.content(me);
  const [f, setF] = useState({ name: m.name, tags: (m.tags ?? []).join(', '), collection_id: m.collection_id ?? '' });
  const { data: usage } = useLoad(() => get(`/api/media/${m.id}/usage`), [m.id]);
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [cur, setCur] = useState(m);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [repl, setRepl] = useState<number | null>(null);
  return (
    <Modal open onClose={onClose} title={cur.name} wide>
      {confirm.node}
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="rounded-xl bg-preto p-2">
            {cur.kind === 'video'
              ? <video key={cur.url} src={cur.url} controls muted className="w-full aspect-video bg-black rounded" />
              : <img key={cur.url} src={cur.url} alt={cur.name} className="w-full aspect-video object-contain bg-black rounded" />}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {compatBadge(cur.compat)}
            <Badge>{cur.mime}</Badge><Badge>{cur.width}×{cur.height}</Badge><Badge>{fmtBytes(cur.size_bytes)}</Badge>
            {cur.kind === 'video' && <><Badge>{fmtDur(cur.duration_ms)}</Badge><Badge>codec {cur.codec}</Badge></>}
          </div>
          {cur.compat_notes && <p className="mt-2 text-xs text-laranja-ink bg-laranja-soft rounded-lg p-2 font-semibold">{cur.compat_notes}</p>}
          <p className="text-xs text-cinza mt-2">Enviado em {fmtDate(cur.created_at)} · atualizado em {fmtDate(cur.updated_at)}</p>
        </div>
        <div className="space-y-4">
          <Field label="Nome"><Input disabled={!editable} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Etiquetas" hint="Separe por vírgula. Ex.: burger, noite, promo"><Input disabled={!editable} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
          <Field label="Coleção">
            <Select disabled={!editable} value={f.collection_id} onChange={(e) => setF({ ...f, collection_id: e.target.value })}>
              <option value="">Sem coleção</option>{cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          {editable && <Button disabled={busy} onClick={() => run(() => patch(`/api/media/${m.id}`, { name: f.name, tags: f.tags.split(',').map((t: string) => t.trim()).filter(Boolean), collection_id: f.collection_id || null }), 'Arquivo atualizado.')}>Salvar</Button>}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-cinza mb-1">Onde é usado</p>
            {!usage ? '…' : !usage.playlists.length && !usage.units.length ? <p className="text-sm text-cinza">Não está em nenhuma playlist.</p> : (
              <ul className="text-sm space-y-0.5">
                {usage.playlists.map((p: any) => <li key={p.id}>▸ Playlist <b>{p.name}</b> {p.published ? '' : '(rascunho)'}</li>)}
                {usage.units.map((u: any) => <li key={u.id}>▸ Imagem da unidade <b>{u.name}</b></li>)}
              </ul>
            )}
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-linha">
              <Button variant="ghost" disabled={repl !== null} onClick={() => replaceInput.current?.click()}>{repl !== null ? `Enviando ${Math.round(repl * 100)}%` : 'Substituir arquivo'}</Button>
              <input ref={replaceInput} type="file" className="hidden" accept={cur.kind === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp'} onChange={async (e) => {
                const file = e.target.files?.[0]; e.target.value = '';
                if (!file) return;
                setRepl(0);
                const a = await run(() => uploadMedia(file, { replaceId: m.id, onProgress: setRepl }), 'Arquivo substituído. Publique as playlists que o usam para levar às TVs.');
                setRepl(null);
                if (a) setCur(a);
              }} />
              <Button variant="danger" onClick={async () => {
                if (await confirm.ask('Excluir arquivo?', `"${cur.name}" sairá da biblioteca.`, 'Excluir')) { const r = await run(() => del(`/api/media/${m.id}`), 'Arquivo excluído.'); if (r) onClose(); }
              }}>Excluir</Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Collections({ cols, onClose }: { cols: any[]; onClose: () => void }) {
  const [list, setList] = useState(cols);
  const [name, setName] = useState('');
  const { run } = useAction();
  const confirm = useConfirm();
  const reload = () => get('/api/collections').then(setList);
  return (
    <Modal open onClose={onClose} title="Coleções">
      {confirm.node}
      <ul className="space-y-1.5 mb-4">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <Input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && run(() => patch(`/api/collections/${c.id}`, { name: e.target.value }), 'Coleção renomeada.').then(reload)} />
            <span className="text-xs text-cinza w-16 shrink-0">{c.media_count} arq.</span>
            <Button size="sm" variant="ghost" onClick={async () => { if (await confirm.ask('Remover coleção?', 'Os arquivos continuam na biblioteca, só sem coleção.', 'Remover')) run(() => del(`/api/collections/${c.id}`)).then(reload); }}>Remover</Button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => post('/api/collections', { name }), 'Coleção criada.').then(() => { setName(''); reload(); }); }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova coleção" />
        <Button type="submit" disabled={!name}>Criar</Button>
      </form>
    </Modal>
  );
}
