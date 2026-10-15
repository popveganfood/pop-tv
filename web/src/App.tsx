import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post, setUnauthorizedHandler } from './api.ts';
import { Router, Toasts, useRoute, Link, Button, Input, Field, ErrorBox, Loading } from './ui.tsx';
import Dashboard from './pages/Dashboard.tsx';
import Screens from './pages/Screens.tsx';
import Units from './pages/Units.tsx';
import Media from './pages/Media.tsx';
import Playlists, { PlaylistEditor } from './pages/Playlists.tsx';
import Schedules from './pages/Schedules.tsx';
import Users from './pages/Users.tsx';

export type Me = { id: string; name: string; email: string; role: 'admin' | 'marketing' | 'manager'; all_units: boolean; can_manage_screens: boolean; can_publish: boolean; unit_ids: string[] };
const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const can = {
  admin: (m: Me) => m.role === 'admin',
  content: (m: Me) => m.role === 'admin' || m.role === 'marketing',
  publish: (m: Me) => m.role !== 'manager' || m.can_publish,
  screens: (m: Me, unitId?: string) => m.role === 'admin' || (m.role === 'manager' && m.can_manage_screens && (!unitId || m.all_units || m.unit_ids.includes(unitId))),
};
export const ROLE_LABEL = { admin: 'Administrador geral', marketing: 'Marketing', manager: 'Gerente de unidade' };

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    get('/api/auth/me').then((r) => setMe(r.user)).catch(() => setMe(null));
  }, []);
  if (me === undefined) return <Loading />;
  return (
    <Toasts>
      <Router>
        {me ? <MeCtx.Provider value={me}><Shell onLogout={() => setMe(null)} /></MeCtx.Provider> : <Login onIn={setMe} />}
      </Router>
    </Toasts>
  );
}

function Login({ onIn }: { onIn: (m: Me) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await post('/api/auth/login', { email, password }); onIn((await get('/api/auth/me')).user); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <section className="relative bg-preto text-white p-8 sm:p-14 flex flex-col justify-between overflow-hidden">
        <img src="/logo.png" alt="POP Vegan Food" className="w-20 h-20" />
        <div className="my-12">
          <p className="text-laranja font-bold tracking-[.35em] text-xs uppercase mb-4">POP TV</p>
          <h1 className="text-5xl sm:text-7xl font-black leading-[.92] tracking-tight">
            Suas telas,<br /><span className="text-pop">sem</span> pendrive.
          </h1>
          <p className="mt-6 text-white/75 max-w-md">Troque campanhas, cardápios e promoções em todas as TVs do POP direto daqui.</p>
        </div>
        <p className="text-white/50 text-xs font-semibold">Democratizando a comida vegana.</p>
        <div className="absolute left-0 right-0 bottom-0"><div className="pop-stripe h-3" /></div>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12 bg-white">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4 animate-rise">
          <h2 className="text-3xl font-black">Entrar</h2>
          <p className="text-sm text-cinza -mt-2">Use o e-mail cadastrado pelo administrador.</p>
          <Field label="E-mail"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Senha"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {err && <ErrorBox msg={err} />}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar no painel'}</Button>
        </form>
      </section>
    </div>
  );
}

const NAV: { to: string; label: string; icon: string; show?: (m: Me) => boolean }[] = [
  { to: '/', label: 'Início', icon: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z' },
  { to: '/telas', label: 'Telas', icon: 'M3 5h18v11H3zM8 20h8M12 16v4' },
  { to: '/programacao', label: 'Programação', icon: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4' },
  { to: '/playlists', label: 'Playlists', icon: 'M4 6h12M4 12h12M4 18h7M17 14l4 2.5-4 2.5z' },
  { to: '/midia', label: 'Mídia', icon: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4' },
  { to: '/unidades', label: 'Unidades', icon: 'M12 21s-7-6.1-7-11a7 7 0 1114 0c0 4.9-7 11-7 11zM12 12a2 2 0 100-4 2 2 0 000 4z' },
  { to: '/usuarios', label: 'Usuários', icon: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3 3 0 100-6 3 3 0 000 6zM21 19v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8', show: can.admin },
];

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const me = useMe();
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (to: string) => (to === '/' ? path === '/' : path.startsWith(to));
  let page: ReactNode;
  if (path.startsWith('/playlists/')) page = <PlaylistEditor id={path.split('/')[2]} />;
  else page = ({ '/': <Dashboard />, '/telas': <Screens />, '/programacao': <Schedules />, '/playlists': <Playlists />, '/midia': <Media />, '/unidades': <Units />, '/usuarios': <Users /> } as Record<string, ReactNode>)[path] ?? <Dashboard />;

  return (
    <div className="min-h-screen lg:pl-64">
      {/* menu lateral */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-preto text-white flex flex-col transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 pt-6 pb-5 flex items-center gap-3">
          <img src="/logo.png" alt="POP Vegan Food" className="w-12 h-12" />
          <div className="leading-tight">
            <p className="font-black text-xl tracking-tight">POP <span className="text-pop">TV</span></p>
            <p className="text-[10px] font-bold tracking-[.3em] text-laranja">VEGAN FOOD</p>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {NAV.filter((n) => !n.show || n.show(me)).map((n) => (
            <Link key={n.to} to={n.to} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition ${active(n.to) ? 'bg-pop text-white' : 'text-white/75 hover:text-white hover:bg-white/10'}`}>
              <Icon d={n.icon} />{n.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-white/10">
          <p className="text-sm font-bold truncate">{me.name}</p>
          <p className="text-xs text-white/55 mb-3">{ROLE_LABEL[me.role]}</p>
          <button className="text-xs font-bold text-laranja hover:underline" onClick={async () => { await post('/api/auth/logout'); onLogout(); }}>Sair</button>
        </div>
        <div className="pop-stripe" />
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      {/* cabeçalho no celular */}
      <header className="lg:hidden sticky top-0 z-20 bg-preto text-white flex items-center justify-between px-4 h-14">
        <button onClick={() => setOpen(true)} className="w-10 h-10 -ml-2 grid place-items-center" aria-label="Abrir menu">
          <svg viewBox="0 0 24 24" className="w-6 h-6" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <p className="font-black">POP <span className="text-pop">TV</span></p>
        <img src="/logo.png" alt="" className="w-8 h-8" />
      </header>

      <main className="px-4 sm:px-8 py-6 sm:py-8 max-w-[1400px]">{page}</main>
    </div>
  );
}
