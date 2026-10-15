# Contrato da API — POP TV

Todas as respostas são JSON. Erros: `{ "error": "mensagem em português" }` com status HTTP.
Mutações administrativas exigem `Content-Type: application/json` (proteção CSRF) e cookie de sessão.

## Autenticação (`/api/auth`)
| Método | Rota | Quem | Descrição |
|---|---|---|---|
| POST | /api/auth/login `{email,password}` | público (limitado: 10/min/IP) | cria sessão (cookie `pop_session`) |
| POST | /api/auth/logout | logado | encerra sessão |
| GET | /api/auth/me | logado | usuário + permissões efetivas |

## Usuários (`admin`)
GET/POST /api/users · PATCH/DELETE /api/users/:id (`{name,email,password?,role,active,all_units,can_manage_screens,can_publish,unit_ids[]}`)

## Organização
- GET/PATCH /api/org (`fallback_playlist_id`, `offline_after_seconds`) — PATCH admin
- GET /api/units?archived=1 · POST /api/units (admin) · PATCH /api/units/:id (admin)
- POST /api/units/:id/archive · /unarchive (admin)
- POST /api/units/:id/duplicate `{name, copy_environments, copy_schedules, copy_playlists}` (admin)
- GET/POST /api/units/:id/environments · PATCH /api/environments/:id · POST /api/units/:id/environments/reorder `{ids[]}`
- GET /api/screens?unit_id= · PATCH /api/screens/:id · DELETE /api/screens/:id
- POST /api/screens/:id/revoke · POST /api/screens/:id/repair `{code}`
- GET /api/screens/:id/logs
- GET/POST /api/groups · PATCH/DELETE /api/groups/:id · PUT /api/groups/:id/members `{screen_ids[]}`

## Pareamento (painel)
POST /api/pairing/claim `{code, unit_id, environment_id?, name, manufacturer?, model?, orientation, playlist_id?, group_ids?}`
— limitado a 10 tentativas/10 min por usuário. `playlist_id` cria regra Padrão para a tela.

## Mídia
- GET /api/media?q=&kind=&collection_id=&tag=
- POST /api/media/uploads `{name, mime, size}` → `{asset, upload:{url, method:'PUT', headers}}`
- POST /api/media/:id/complete → valida bytes e metadados → `asset`
- POST /api/media/:id/replace `{mime,size}` → nova URL de upload; `complete` troca o arquivo
- POST /api/media/:id/thumbnail `{size}` → URL de upload de miniatura (JPEG)
- PATCH /api/media/:id `{name, tags, collection_id}` · DELETE /api/media/:id (409 se em uso)
- GET /api/media/:id/usage · GET /api/media/:id/url (URL assinada de leitura)
- GET/POST /api/collections · PATCH/DELETE /api/collections/:id

## Playlists
- GET /api/playlists · POST /api/playlists · GET/PATCH/DELETE /api/playlists/:id
- PUT /api/playlists/:id/items `{items:[{media_id, duration_ms?}]}` (salvar rascunho)
- POST /api/playlists/:id/duplicate · POST /api/playlists/:id/publish `{note?}`
- GET /api/playlists/:id/versions · POST /api/playlists/:id/versions/:versionId/restore

## Regras de exibição (publicação/agendamento)
- GET /api/schedules · POST /api/schedules · PATCH/DELETE /api/schedules/:id
  (409 `{error, conflicts:[...]}` quando há conflito ambíguo)
- POST /api/schedules/check (mesmo corpo do POST) → `{conflicts, affected_screens}`
- GET /api/screens/:id/resolve?at=AAAA-MM-DDTHH:mm → regra vencedora, regras sobrepostas, itens
- GET /api/calendar?unit_id=&from=&days= → blocos para o calendário

## Dashboard
GET /api/dashboard → contadores, telas com status, próximos agendamentos, últimas alterações.
GET /api/audit?limit=

## Player (TV) — sem sessão de usuário
| Método | Rota | Descrição |
|---|---|---|
| POST | /api/player/pair/start | cria código (limitado por IP) → `{code, poll_token, expires_at}` |
| POST | /api/player/pair/poll `{poll_token}` | `{status:'waiting'|'expired'}` ou `{status:'paired', device_token}` + cookie `pop_device` |
| POST | /api/player/sync `{version, state, item, error, capabilities}` (Bearer ou cookie) | heartbeat; `{changed:false}` ou `{changed:true, manifest}`; 401 se revogado |

Manifesto: `{version, poll_seconds, screen:{id,name,orientation}, playlist:{id,name,version}|null,
rule:{id,name,priority}|null, items:[{key, kind, mime, url, duration_ms, width, height}], urls_expire_at}`
