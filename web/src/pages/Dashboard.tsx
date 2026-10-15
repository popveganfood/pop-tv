import { useEffect, useState } from 'react';
import { get } from '../api.ts';
import { Card, PageHeader, Button, Empty, Loading, ErrorBox, Badge, useLoad, fmtDate, fmtLocal, useRoute } from '../ui.tsx';
import { useMe, can } from '../App.tsx';
import { TvWall, PairModal } from './Screens.tsx';

function Stat({ n, label, tone = 'tinta' }: { n: number | string; label: string; tone?: 'tinta' | 'ok' | 'pop' | 'laranja' }) {
  const color = { tinta: 'text-tinta', ok: 'text-ok', pop: 'text-pop', laranja: 'text-laranja-ink' }[tone];
  return (
    <Card className="p-4">
      <p className={`text-4xl font-black tracking-tight ${color}`}>{n}</p>
      <p className="text-xs font-bold uppercase tracking-wider text-cinza mt-1">{label}</p>
    </Card>
  );
}

export default function Dashboard() {
  const me = useMe();
  const { data, error, loading, reload } = useLoad(() => get('/api/dashboard'));
  const [pair, setPair] = useState(false);
  const { go } = useRoute();
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox msg={error} />;
  const c = data.counts;
  const first = me.name.split(' ')[0];
  return (
    <>
      <PageHeader title={`Olá, ${first}.`} mark="Tudo no ar?" sub={`${c.online} de ${c.screens} telas respondendo agora. TVs sem contato por mais de ${data.offline_after_seconds} s aparecem offline.`}
        actions={<>
          {can.content(me) && <Button variant="dark" onClick={() => go('/playlists')}>Trocar uma promoção</Button>}
          {data.units.some((u: any) => can.screens(me, u.id)) && <Button onClick={() => setPair(true)}>+ Adicionar tela</Button>}
        </>} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
        <Stat n={c.units} label="Unidades" />
        <Stat n={c.screens} label="Telas" />
        <Stat n={c.online} label="Telas online" tone="ok" />
        <Stat n={c.offline} label="Telas offline" tone={c.offline ? 'pop' : 'tinta'} />
        <Stat n={c.campaigns_live} label="Campanhas no ar" tone="laranja" />
        <Stat n={c.playlists_published} label="Playlists publicadas" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div>
          {data.screens.length ? <TvWall screens={data.screens} reload={reload} /> :
            <Empty title="Nenhuma TV conectada ainda" text="Comece pareando a primeira TV: abra /tv no navegador dela e digite o código aqui." action={<Button onClick={() => setPair(true)}>+ Adicionar tela</Button>} />}
        </div>
        <aside className="space-y-4">
          <Card className="p-4">
            <h3 className="font-black mb-3">No ar agora</h3>
            {data.live_campaigns.length ? <ul className="space-y-2">{data.live_campaigns.map((r: any) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-sm"><span className="font-semibold truncate">{r.name}</span><Badge tone={r.priority_label === 'Emergência' ? 'pop' : 'laranja'}>{r.priority_label}</Badge></li>
            ))}</ul> : <p className="text-sm text-cinza">Nenhuma campanha ou emergência ativa.</p>}
          </Card>
          <Card className="p-4">
            <h3 className="font-black mb-3">Próximos agendamentos</h3>
            {data.upcoming.length ? <ul className="space-y-2">{data.upcoming.map((u: any) => (
              <li key={u.id} className="text-sm"><p className="font-semibold">{u.name}</p><p className="text-xs text-cinza">começa {fmtLocal(u.starts)} · {u.screens} tela(s) · {u.priority_label}</p></li>
            ))}</ul> : <p className="text-sm text-cinza">Nada programado para as próximas 48 h.</p>}
          </Card>
          <Card className="p-4">
            <h3 className="font-black mb-3">Últimas alterações</h3>
            <ul className="space-y-2.5">{data.changes.map((a: any, i: number) => (
              <li key={i} className="text-sm leading-snug"><p>{a.summary}</p><p className="text-xs text-cinza">{a.user_name ?? 'Sistema'} · {fmtDate(a.created_at)}</p></li>
            ))}</ul>
          </Card>
        </aside>
      </div>
      <PairModal open={pair} onClose={(p) => { setPair(false); if (p) reload(); }} />
    </>
  );
}
