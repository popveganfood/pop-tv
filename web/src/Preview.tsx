// Simulador de tela: toca a sequência no painel. NÃO é a transmissão ao vivo da TV.
import { useEffect, useRef, useState } from 'react';
import { Modal, Button, fmtDur, Badge } from './ui.tsx';

export type PreviewItem = { name: string; kind: 'image' | 'video'; url: string | null; duration_ms?: number | null; media_duration_ms?: number | null };

export function PreviewModal({ open, onClose, items, playlistName, screenName, orientation = 'landscape', note }: {
  open: boolean; onClose: () => void; items: PreviewItem[]; playlistName?: string; screenName?: string; orientation?: string; note?: string;
}) {
  const [ratio, setRatio] = useState<'16:9' | '9:16'>(orientation === 'portrait' ? '9:16' : '16:9');
  const [i, setI] = useState(0);
  const [progress, setProgress] = useState(0);
  const timer = useRef<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { setI(0); setRatio(orientation === 'portrait' ? '9:16' : '16:9'); }, [open, items, orientation]);
  const it = items[i];
  const next = () => setI((x) => (items.length ? (x + 1) % items.length : 0));

  useEffect(() => {
    clearInterval(timer.current);
    setProgress(0);
    if (!open || !it) return;
    if (it.kind === 'image') {
      const dur = it.duration_ms || 10000, t0 = Date.now();
      timer.current = window.setInterval(() => {
        const p = (Date.now() - t0) / dur;
        setProgress(Math.min(p, 1));
        if (p >= 1) next();
      }, 100);
    }
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, open, it]);

  const box = ratio === '16:9' ? 'aspect-video w-full' : 'aspect-[9/16] h-[60vh] w-[calc(60vh*9/16)] max-w-full mx-auto';
  return (
    <Modal open={open} onClose={onClose} title="Pré-visualização" wide>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Badge tone="laranja">Simulação — não é a imagem ao vivo da TV</Badge>
        {screenName && <Badge tone="neutro">Tela: {screenName}</Badge>}
        {playlistName && <Badge tone="neutro">Playlist: {playlistName}</Badge>}
        <div className="ml-auto flex gap-1">
          {(['16:9', '9:16'] as const).map((r) => (
            <Button key={r} size="sm" variant={ratio === r ? 'dark' : 'ghost'} onClick={() => setRatio(r)}>{r === '16:9' ? 'Horizontal 16:9' : 'Vertical 9:16'}</Button>
          ))}
        </div>
      </div>
      {note && <p className="text-sm text-cinza mb-3">{note}</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div>
          <div className="rounded-[18px] bg-preto p-3 shadow-card">
            <div className={`relative bg-black overflow-hidden rounded-md ${box}`}>
              {!it && <div className="absolute inset-0 grid place-items-center text-white/80 text-sm font-semibold">Sem conteúdo — a TV mostraria a tela da marca POP.</div>}
              {it?.kind === 'image' && it.url && <img key={i} src={it.url} alt={it.name} className="absolute inset-0 w-full h-full object-contain animate-rise" />}
              {it?.kind === 'video' && it.url && (
                <video key={i} ref={videoRef} src={it.url} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-contain"
                  onEnded={next} onError={next} onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))} />
              )}
              <span className="absolute top-2 left-2 bg-black/70 text-laranja text-[10px] font-black tracking-widest px-2 py-1 rounded">SIMULAÇÃO</span>
            </div>
          </div>
          <div className="mt-2 h-1.5 bg-black/10 rounded-full overflow-hidden"><div className="h-full bg-pop transition-[width]" style={{ width: `${progress * 100}%` }} /></div>
        </div>
        <ol className="space-y-1 max-h-[60vh] overflow-y-auto">
          {items.map((x, k) => (
            <li key={k}>
              <button onClick={() => setI(k)} className={`w-full text-left rounded-xl px-3 py-2 text-sm flex justify-between gap-2 ${k === i ? 'bg-pop text-white' : 'hover:bg-black/5'}`}>
                <span className="truncate font-semibold">{k + 1}. {x.name}</span>
                <span className="shrink-0 opacity-80">{x.kind === 'image' ? fmtDur(x.duration_ms || 10000) : `vídeo ${fmtDur(x.media_duration_ms ?? x.duration_ms)}`}</span>
              </button>
            </li>
          ))}
          {!!items.length && <li className="text-xs text-cinza px-3 pt-2">Ao final, recomeça automaticamente.</li>}
        </ol>
      </div>
    </Modal>
  );
}
