// Componentes reutilizáveis do POP TV (botões, cards, modais, avisos, status, mídia, roteador).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------------- roteador mínimo (History API) ----------------
const RouteCtx = createContext<{ path: string; go: (p: string) => void }>({ path: '/', go: () => {} });
export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const f = () => setPath(location.pathname); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  const go = useCallback((p: string) => { if (p !== location.pathname) history.pushState(null, '', p); setPath(p); scrollTo(0, 0); }, []);
  return <RouteCtx.Provider value={{ path, go }}>{children}</RouteCtx.Provider>;
}
export const useRoute = () => useContext(RouteCtx);
export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const { go } = useRoute();
  return <a href={to} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(to); }}>{children}</a>;
}

// ---------------- notificações ----------------
type Toast = { id: number; kind: 'ok' | 'erro' | 'info'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export function Toasts({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, kind, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'erro' ? 7000 : 4000);
  }, []);
  // os avisos ficam na "top layer" (popover) para aparecer por cima de modais abertos
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current as any;
    if (!el?.showPopover) return;
    try { if (el.matches(':popover-open')) el.hidePopover(); if (list.length) el.showPopover(); } catch { /* sem suporte */ }
  }, [list]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div ref={box} popover="manual" className="fixed inset-auto bottom-4 right-4 left-4 sm:left-auto m-0 p-0 bg-transparent border-0 overflow-visible z-[100] flex-col gap-2 sm:w-96 [&:popover-open]:flex" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`animate-rise rounded-pop px-4 py-3 text-sm font-semibold shadow-card border-l-8 bg-white ${t.kind === 'ok' ? 'border-ok' : t.kind === 'erro' ? 'border-pop' : 'border-laranja'}`}>
            {t.kind === 'ok' ? '✓ ' : t.kind === 'erro' ? '✕ ' : ''}{t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- carregamento de dados ----------------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => {
    setLoading(true);
    return fn().then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

/** executa uma ação com aviso de sucesso/erro */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast('ok', ok); return r; }
    catch (e: any) { toast('erro', e.message); return undefined; }
    finally { setBusy(false); }
  }, [toast]);
  return { run, busy };
}

// ---------------- básicos ----------------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'pop' | 'dark' | 'ghost' | 'danger' | 'light'; size?: 'sm' | 'md' | 'lg' };
export function Button({ variant = 'pop', size = 'md', className = '', ...p }: BtnProps) {
  const v = {
    pop: 'bg-pop text-white hover:bg-pop-dark',
    dark: 'bg-preto text-white hover:bg-tinta/85',
    ghost: 'bg-transparent text-tinta hover:bg-black/5 border border-linha',
    light: 'bg-white text-tinta hover:bg-fundo border border-linha',
    danger: 'bg-white text-pop-dark border-2 border-pop hover:bg-pop-soft',
  }[variant];
  const s = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }[size];
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap transition active:scale-[.97] disabled:opacity-50 disabled:pointer-events-none ${v} ${s} ${className}`} />;
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`bg-white rounded-pop shadow-card border border-black/5 ${className}`}>{children}</div>;
}

export function PageHeader({ title, mark, sub, actions }: { title: string; mark?: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between animate-rise">
      <div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-none">
          {title} {mark && <span className="poster-mark">{mark}</span>}
        </h1>
        {sub && <p className="mt-2 text-cinza text-sm max-w-2xl">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wider text-cinza mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-cinza mt-1">{hint}</span>}
    </label>
  );
}
const inputCls = 'w-full h-11 rounded-xl border border-linha bg-white px-3 text-sm font-medium focus:border-pop focus:outline-none focus:ring-2 focus:ring-pop/20';
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ''}`} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} ${p.className ?? ''}`} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`${inputCls} h-auto! py-2 ${p.className ?? ''}`} />;

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-3 cursor-pointer select-none text-sm font-semibold">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full relative transition ${checked ? 'bg-pop' : 'bg-black/20'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      {label}
    </label>
  );
}

export function Badge({ tone = 'neutro', children }: { tone?: 'ok' | 'pop' | 'laranja' | 'neutro' | 'preto'; children: ReactNode }) {
  const c = { ok: 'bg-ok-soft text-ok', pop: 'bg-pop-soft text-pop-dark', laranja: 'bg-laranja-soft text-laranja-ink', neutro: 'bg-black/5 text-cinza', preto: 'bg-preto text-white' }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${c}`}>{children}</span>;
}

export function StatusPill({ online, paired = true }: { online: boolean; paired?: boolean }) {
  if (!paired) return <Badge tone="laranja">Sem pareamento</Badge>;
  return online
    ? <span className="inline-flex items-center gap-2 text-xs font-bold text-pop-dark"><span className="live-dot" />No ar</span>
    : <span className="inline-flex items-center gap-2 text-xs font-bold text-cinza"><span className="w-2.5 h-2.5 rounded-full bg-sinal" />Sem sinal</span>;
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="rounded-pop border-2 border-dashed border-black/15 p-10 text-center bg-white/60">
      <img src="/logo.png" alt="" className="w-14 h-14 mx-auto mb-3 opacity-90" />
      <p className="font-black text-lg">{title}</p>
      {text && <p className="text-sm text-cinza mt-1 max-w-md mx-auto">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const Loading = () => <div className="py-16 text-center text-cinza font-semibold animate-pulse">Carregando…</div>;
export const ErrorBox = ({ msg }: { msg: string }) => <div className="rounded-pop bg-pop-soft text-pop-dark p-4 font-semibold text-sm">{msg}</div>;

// ---------------- modal (dialog nativo: foco e Esc acessíveis) ----------------
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={`m-auto p-0 rounded-pop bg-white shadow-2xl w-[calc(100%-1.5rem)] ${wide ? 'max-w-5xl' : 'max-w-xl'} max-h-[92vh]`}>
      {open && (
        <div className="flex flex-col max-h-[92vh]">
          <div className="pop-stripe rounded-t-pop" />
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="text-xl font-black">{title}</h2>
            <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-black/5 text-xl font-bold" aria-label="Fechar">×</button>
          </div>
          <div className="px-5 pb-5 overflow-y-auto">{children}</div>
          {footer && <div className="px-5 py-4 border-t border-linha flex flex-wrap justify-end gap-2 bg-fundo/60 rounded-b-pop">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** confirmação explícita para ações irreversíveis */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; text: string; danger?: string; resolve: (v: boolean) => void } | null>(null);
  const ask = (title: string, text: string, danger = 'Confirmar') => new Promise<boolean>((resolve) => setState({ title, text, danger, resolve }));
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  const node = (
    <Modal open={!!state} onClose={() => close(false)} title={state?.title ?? ''}
      footer={<><Button variant="ghost" onClick={() => close(false)}>Cancelar</Button><Button onClick={() => close(true)}>{state?.danger}</Button></>}>
      <p className="text-sm text-tinta/80">{state?.text}</p>
    </Modal>
  );
  return { ask, node };
}

// ---------------- mídia ----------------
export function Thumb({ url, kind, className = '', alt = '', corner }: { url?: string | null; kind?: string; className?: string; alt?: string; corner?: boolean }) {
  return (
    <div className={`relative bg-preto overflow-hidden ${className}`}>
      {url ? <img src={url} alt={alt} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        : corner ? <><img src="/logo.png" alt="" className="absolute top-3 right-3 w-12 h-12" /><div className="absolute left-0 top-0 h-full w-2 bg-pop" /></>
        : <div className="absolute inset-0 grid place-items-center"><img src="/logo.png" alt="" className="w-1/4 max-w-20 opacity-80" /></div>}
      {kind === 'video' && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/75 text-white text-[10px] font-bold px-2 py-0.5">▶ VÍDEO</span>}
    </div>
  );
}

export const compatBadge = (c?: string) =>
  c === 'ok' ? <Badge tone="ok">Compatível</Badge> : c === 'warning' ? <Badge tone="laranja">Atenção</Badge> : c === 'incompatible' ? <Badge tone="pop">Incompatível</Badge> : null;

// ---------------- formatação ----------------
export const fmtBytes = (n?: number | null) => !n ? '—' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
export const fmtDur = (ms?: number | null) => {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}min${s % 60 ? ` ${s % 60}s` : ''}` : `${s}s`;
};
export const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export function ago(d?: string | null) {
  if (!d) return 'nunca';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `há ${Math.max(s, 1)} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dias`;
}
export const fmtLocal = (s?: string | null) => s ? s.replace(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}).*$/, '$3/$2/$1 $4:$5') : '';
export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'];
