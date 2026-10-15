import { useEffect, useState } from 'react';
import { get, post, patch } from '../api.ts';
import { Button, Card, PageHeader, Field, Input, Select, Toggle, Badge, Loading, ErrorBox, Modal, useLoad, useAction, fmtDate } from '../ui.tsx';
import { useMe, ROLE_LABEL } from '../App.tsx';

export default function Users() {
  const [tab, setTab] = useState<'usuarios' | 'historico' | 'config'>('usuarios');
  return (
    <>
      <PageHeader title="Usuários" mark="e acesso" sub="Quem pode fazer o quê. Todas as permissões são conferidas também no servidor." />
      <div className="flex gap-1 border-b border-linha mb-6">
        {([['usuarios', 'Usuários'], ['historico', 'Histórico de ações'], ['config', 'Configurações gerais']] as const).map(([k, l]) =>
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm font-bold border-b-4 -mb-px ${tab === k ? 'border-pop' : 'border-transparent text-cinza'}`}>{l}</button>)}
      </div>
      {tab === 'usuarios' && <UserList />}
      {tab === 'historico' && <Audit />}
      {tab === 'config' && <Settings />}
    </>
  );
}

function UserList() {
  const { data, error, loading, reload } = useLoad(() => get('/api/users'));
  const { data: units } = useLoad(() => get('/api/units'));
  const [edit, setEdit] = useState<any>(null);
  if (error) return <ErrorBox msg={error} />;
  if (loading && !data) return <Loading />;
  return (
    <>
      <div className="flex justify-end mb-3"><Button onClick={() => setEdit({ role: 'marketing', unit_ids: [], active: true })}>+ Novo usuário</Button></div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead><tr className="text-left text-xs uppercase tracking-wider text-cinza border-b border-linha"><th className="p-3">Nome</th><th>Perfil</th><th>Unidades</th><th>Último acesso</th><th></th></tr></thead>
          <tbody>
            {data.map((u: any) => (
              <tr key={u.id} className="border-b border-linha/70">
                <td className="p-3"><p className="font-bold">{u.name}</p><p className="text-xs text-cinza">{u.email}</p></td>
                <td><Badge tone={u.role === 'admin' ? 'preto' : u.role === 'marketing' ? 'pop' : 'laranja'}>{ROLE_LABEL[u.role as 'admin']}</Badge>{!u.active && <Badge>inativo</Badge>}</td>
                <td className="text-xs">{u.role === 'admin' || u.all_units ? 'Todas' : u.unit_ids.map((id: string) => units?.find((x: any) => x.id === id)?.name).filter(Boolean).join(', ') || 'Nenhuma'}</td>
                <td className="text-xs text-cinza">{fmtDate(u.last_login_at)}</td>
                <td className="text-right pr-3"><Button size="sm" variant="ghost" onClick={() => setEdit(u)}>Editar</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {edit && <UserForm u={edit} units={units ?? []} onClose={(s) => { setEdit(null); if (s) reload(); }} />}
    </>
  );
}

function UserForm({ u, units, onClose }: { u: any; units: any[]; onClose: (saved: boolean) => void }) {
  const me = useMe();
  const isNew = !u.id;
  const [f, setF] = useState({ name: u.name ?? '', email: u.email ?? '', password: '', role: u.role, active: u.active ?? true, all_units: !!u.all_units, can_manage_screens: !!u.can_manage_screens, can_publish: !!u.can_publish, unit_ids: u.unit_ids ?? [] });
  const { run, busy } = useAction();
  const save = async () => {
    const body: any = { ...f };
    if (!body.password) delete body.password;
    const r = await run(() => (isNew ? post('/api/users', body) : patch(`/api/users/${u.id}`, body)), 'Usuário salvo.');
    if (r) onClose(true);
  };
  return (
    <Modal open onClose={() => onClose(false)} title={isNew ? 'Novo usuário' : `Editar ${u.name}`}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button disabled={busy || !f.name || !f.email || (isNew && f.password.length < 8)} onClick={save}>Salvar</Button></>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <Field label={isNew ? 'Senha inicial' : 'Nova senha (deixe em branco para manter)'} hint="Mínimo de 8 caracteres. Trocar a senha encerra as sessões abertas.">
          <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Perfil">
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} disabled={u.id === me.id}>
            <option value="admin">Administrador geral — tudo, inclusive usuários e unidades</option>
            <option value="marketing">Marketing — mídia, playlists e publicação nas unidades autorizadas</option>
            <option value="manager">Gerente de unidade — vê as TVs da sua unidade</option>
          </Select>
        </Field>
        {f.role !== 'admin' && (
          <>
            <Toggle checked={f.all_units} onChange={(v) => setF({ ...f, all_units: v })} label="Acesso a todas as unidades (inclui publicar para todas)" />
            {!f.all_units && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-cinza mb-1">Unidades autorizadas</p>
                <div className="flex flex-wrap gap-2">
                  {units.map((x) => { const on = f.unit_ids.includes(x.id); return <button key={x.id} type="button" onClick={() => setF({ ...f, unit_ids: on ? f.unit_ids.filter((i: string) => i !== x.id) : [...f.unit_ids, x.id] })} className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 ${on ? 'bg-preto text-white border-preto' : 'border-linha'}`}>{x.name}</button>; })}
                </div>
              </div>
            )}
            {f.role === 'manager' && (
              <Card className="p-3 space-y-2 bg-fundo">
                <p className="text-xs font-bold uppercase tracking-wider text-cinza">Liberações do gerente</p>
                <Toggle checked={f.can_manage_screens} onChange={(v) => setF({ ...f, can_manage_screens: v })} label="Parear, editar e revogar telas; criar ambientes e grupos" />
                <Toggle checked={f.can_publish} onChange={(v) => setF({ ...f, can_publish: v })} label="Trocar programação das telas da unidade" />
              </Card>
            )}
          </>
        )}
        {!isNew && u.id !== me.id && <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={f.active ? 'Usuário ativo' : 'Usuário bloqueado'} />}
      </div>
    </Modal>
  );
}

function Audit() {
  const { data, loading } = useLoad(() => get('/api/audit?limit=200'));
  if (loading && !data) return <Loading />;
  return (
    <Card className="divide-y divide-linha">
      {data.map((a: any) => (
        <div key={a.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm">
          <span className="text-xs text-cinza w-36 shrink-0">{fmtDate(a.created_at)}</span>
          <Badge tone={a.action === 'publicar' ? 'pop' : 'neutro'}>{a.action}</Badge>
          <span className="flex-1">{a.summary}</span>
          <span className="text-xs font-bold">{a.user_name ?? 'Sistema'}</span>
        </div>
      ))}
    </Card>
  );
}

function Settings() {
  const { data: org, reload } = useLoad(() => get('/api/org'));
  const { data: playlists } = useLoad(() => get('/api/playlists'));
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (org) setF({ name: org.name, fallback_playlist_id: org.fallback_playlist_id ?? '', offline_after_seconds: org.offline_after_seconds }); }, [org]);
  const { run, busy } = useAction();
  if (!f) return <Loading />;
  return (
    <Card className="p-5 max-w-2xl space-y-4">
      <Field label="Nome da organização"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Playlist de segurança" hint="Toca em qualquer TV quando nenhuma programação se aplica. Mantenha sempre algo institucional publicado nela.">
        <Select value={f.fallback_playlist_id} onChange={(e) => setF({ ...f, fallback_playlist_id: e.target.value })}>
          <option value="">Nenhuma (TV mostra a tela da marca)</option>
          {playlists?.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.published_version ? '' : ' — não publicada'}</option>)}
        </Select>
      </Field>
      <Field label="Considerar TV offline após (segundos)" hint="As TVs sincronizam a cada 30 s. 90 s = três sincronizações perdidas.">
        <Input type="number" min={30} max={3600} value={f.offline_after_seconds} onChange={(e) => setF({ ...f, offline_after_seconds: Number(e.target.value) })} />
      </Field>
      <Button disabled={busy} onClick={() => run(() => patch('/api/org', { ...f, fallback_playlist_id: f.fallback_playlist_id || null }), 'Configurações salvas.').then(reload)}>Salvar configurações</Button>
    </Card>
  );
}
