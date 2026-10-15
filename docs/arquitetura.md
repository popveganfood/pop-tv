# Arquitetura

```mermaid
flowchart LR
  subgraph Railway["Railway — 1 serviço Node"]
    API["Fastify /api"]
    PANEL["Painel React (estático)"]
    PLAYER["Player /tv (estático)"]
    SNAP["Snapshot em memória\n(regras, telas, versões)"]
  end
  DB[("PostgreSQL\n(Supabase)")]
  R2[("Cloudflare R2\nmídia")]
  ADMIN["Navegador do marketing"] -->|cookie de sessão| API
  ADMIN -->|PUT URL assinada| R2
  TV["Smart TV"] -->|POST /api/player/sync a cada 30 s| API
  TV -->|GET URL assinada (só arquivos novos)| R2
  API --> DB
  API --> SNAP
  API -->|lê início/fim do arquivo para validar| R2
```

## Módulos

| Arquivo | Papel |
|---|---|
| `server/src/app.ts` | monta o Fastify: cookies, CSRF por JSON, erros em pt-BR, estáticos, invalidação do snapshot |
| `server/src/auth.ts` | senha scrypt, sessões, **todas** as regras de permissão |
| `server/src/schedule.ts` | regras de exibição: fuso, janelas, prioridade, conflitos (funções puras) |
| `server/src/resolver.ts` | snapshot em memória e manifesto por TV |
| `server/src/inspect.ts` | valida arquivos pelos bytes reais e extrai resolução/duração/codec |
| `server/src/storage.ts` | R2 (produção) ou disco (dev/teste) com URLs assinadas |
| `server/src/routes/*` | auth/usuários, org (unidades, ambientes, telas, grupos, pareamento), mídia, playlists, programação, dashboard, player |
| `player/player.js` | pareamento, sync, duas camadas com transição, watchdog, cache |
| `player/sw.js` | cache do app e das mídias, respostas `Range` para vídeo |

## Fluxos principais

**Pareamento**: TV → `pair/start` (código 6 letras, 10 min, uso único) → admin `pairing/claim` → TV `pair/poll` recebe a credencial **uma vez** (servidor guarda só o hash) e um cookie HttpOnly. Revogar = `revoked_at`; a TV recebe 401 e volta ao código.

**Upload**: painel pede URL (`/media/uploads`) → envia direto ao R2 numa chave `uploads/…` → `/complete`: o servidor lê 4 MB do início e do fim, confere formato real, tamanho, resolução, duração e codec → copia para `media/…` (chave final, que a URL de envio não alcança) → arquivo fica "pronto". Vídeo: o navegador gera uma miniatura JPEG.

**Publicação**: rascunho (`playlist_items`) → **Publicar** cria `published_versions` imutável. Restaurar = publicar de novo uma versão antiga (nova versão).

**Exibição**: `schedules` une publicação e agendamento: playlist + alvo (todas / unidade / grupo / tela) + prioridade (10/50/100) + período local + janela diária + dias. A cada sync o servidor decide a playlist da TV no fuso da unidade.

**Sync**: a TV envia versão em reprodução, estado, item e erros; o servidor responde `{changed:false}` (curto) ou o manifesto novo. A TV baixa só os arquivos que faltam, um por vez, e troca no fim do item atual. O painel compara a versão confirmada pela TV com a esperada (**"TV confirmou"** vs **"Aguardando TV"**).

## Prioridade e conflitos

1. Maior prioridade: Emergência (100) > Campanha (50) > Padrão (10).
2. Empate: alvo mais específico: tela > grupo > unidade > todas.
3. Empate: regra mais recente.
4. Regra cuja playlist ainda não foi publicada é ignorada (não apaga a TV).
5. Nada → playlist de segurança → nada → tela da marca POP (nunca preta).

Conflito ambíguo (mesma prioridade **e** mesmo nível de alvo, alguma tela em comum, algum minuto em comum) é recusado com a lista dos conflitos. O formulário mostra o resultado previsto antes de salvar.

## Decisões de simplicidade (Ponytail) e seus limites

| Decisão | Limite | Evolução |
|---|---|---|
| Snapshot em memória invalidado por qualquer escrita | 1 instância | LISTEN/NOTIFY do Postgres |
| Rate limit em memória | 1 instância | tabela no Postgres |
| Heartbeat guarda só o último estado (+ erros em `device_logs`) | sem histórico de uptime | tabela de métricas quando houver relatório |
| Conflitos por varredura minuto a minuto (8 dias) | milhares de regras | interseção de intervalos |
| Arquivo antigo de substituição fica no R2 | custo de armazenamento cresce devagar | rotina de limpeza de órfãos |
| Polling de 30 s em vez de WebSocket | troca em até 30 s | `POLL_SECONDS` ou push |
| Auth própria (scrypt + sessão) em vez de Supabase Auth | sem SSO/login social | Supabase Auth se necessário |

## Grafo de conhecimento

`graphify-out/graph.html` (abrir no navegador) e `GRAPH_REPORT.md`. Nós centrais: `api get/post` (painel), `q()/one()` (banco), `scheduleRoutes`, `orgRoutes`, `PlaylistEditor`. Para impacto de uma mudança: `graphify explain "resolve"` ou `graphify path "PlaylistEditor" "published_versions"`. Atualize após mudanças: `graphify update .`.

O grafo liga tabelas por chave estrangeira (`graphify explain "server_migrations_001_init_screens"`) e funções por chamada, mas não enxerga o SQL dentro das strings das rotas. Para saber quais rotas tocam uma tabela antes de alterá-la:

```bash
grep -nE "\b(from|join|into|update)\s+screens\b" server/src/*.ts server/src/routes/*.ts   # troque "screens" pela tabela
```
