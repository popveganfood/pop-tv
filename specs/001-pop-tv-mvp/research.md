# Research — POP TV MVP

Pesquisa feita em 2026-10-14. Preços mudam: reconfirmar antes de contratar.

## R1. Hospedagem: um serviço Railway (API + painel + player)
- **Decision**: um único serviço Node no Railway servindo `/api`, o painel (`/`) e o player (`/tv`).
- **Rationale**: mesma origem → cookies HttpOnly para admin e TV, sem CORS no app, um deploy só.
  Railway Hobby: US$ 5/mês mínimos incluindo US$ 5 de uso; vCPU ≈ US$ 20/mês por vCPU contínua,
  memória ≈ US$ 10/GB-mês, egress US$ 0,05/GB ([railway.com/pricing](https://www.railway.com/pricing)).
- **Alternatives**: Cloudflare Pages para o painel (rejeitado: segundo deploy, CORS e cookies
  cross-site sem ganho real).

## R2. Banco: PostgreSQL via `DATABASE_URL` (Supabase recomendado)
- **Decision**: driver `pg` puro com SQL e migrações em arquivos `.sql`. Funciona com Supabase,
  Railway Postgres ou Postgres local.
- **Rationale**: Supabase Free: 500 MB por projeto, 5 GB de egress, 2 projetos ativos, pausa após 1
  semana sem atividade ([supabase.com/pricing](https://supabase.com/pricing)). As TVs sincronizam a
  cada 30 s, então o projeto nunca fica inativo. O consumo de egress é reduzido mantendo a
  configuração resolvida em memória no servidor (sincronizações não leem o banco a cada vez).
- **Risco**: com 50 TVs o egress de banco fica estimado em ~1–2 GB/mês (dentro dos 5 GB). Se passar,
  migrar para Railway Postgres trocando só `DATABASE_URL`.
- **Alternatives**: ORM (Prisma/Drizzle) rejeitado — dependência pesada para ~20 tabelas.

## R3. Autenticação
- **Decision**: e-mail + senha com `scrypt` (node:crypto), sessão em tabela `sessions`, cookie
  HttpOnly/SameSite=Lax/Secure. Autorização sempre no servidor.
- **Rationale**: Supabase Auth exigiria validar JWT, sincronizar usuários e acoplar o painel ao
  Supabase; o requisito é só login de poucos usuários internos. Menos peças, funciona com qualquer
  Postgres. CSRF: exigência de `Content-Type: application/json` em mutações + SameSite=Lax.
- **Alternatives**: Supabase Auth (adiado; pode ser adicionado se houver login social/SSO).

## R4. Armazenamento: Cloudflare R2 com URL assinada
- **Decision**: upload PUT direto do navegador para o R2 com URL assinada (SigV4 via `aws4fetch`,
  ~2 KB); download pelas TVs e pelo painel também por URL assinada temporária. Servidor valida o
  arquivo lendo o início/fim do objeto (bytes mágicos, metadados MP4/imagem) após o upload.
- **Rationale**: R2 Standard: US$ 0,015/GB-mês, Classe A US$ 4,50/milhão, Classe B US$ 0,36/milhão,
  egress grátis; grátis por mês: 10 GB, 1 M Classe A, 10 M Classe B
  ([developers.cloudflare.com/r2/pricing](https://developers.cloudflare.com/r2/pricing/)).
  Vídeos nunca passam pelo Railway (evita egress de US$ 0,05/GB).
- **Dev/test**: driver `local` (disco) com as mesmas URLs assinadas por HMAC; proibido em produção.
- **Alternatives**: `@aws-sdk/client-s3` (rejeitado: dezenas de MB de dependências).

## R5. Sincronização do player
- **Decision**: `POST /api/player/sync` a cada 30 s, que é heartbeat + consulta de versão. Resposta
  curta `{changed:false}` quando nada mudou; manifesto completo só quando a versão muda.
- **Rationale**: atende "polling leve"; um request por ciclo. Sem WebSocket.

## R6. Cache offline no player
- **Decision**: Cache API + Service Worker (quando disponíveis) guardando mídias por chave estável
  (id do arquivo); o SW responde com suporte a `Range` para vídeo. Manifesto salvo em
  `localStorage`. Sem suporte → toca direto da rede e avisa no painel (capacidade "cache: não").
- **Rationale**: Tizen ≥ 4 e webOS ≥ 4 têm Chromium com SW em contexto seguro (HTTPS);
  modelos antigos não. A detecção de capacidades é enviada no heartbeat e exibida no painel.
- **Limite**: o navegador pode apagar o cache sob pressão de armazenamento — documentado.

## R7. Compatibilidade de TVs
- **Decision**: player em ES5 puro, sem build, `XMLHttpRequest`, sem Promise obrigatória.
- **Rationale**: navegadores de TV antigos não suportam ES2015+. Requisitos mínimos: `<video>` com
  MP4/H.264, `localStorage` ou cookies. Sem isso → recomendação de player externo (Android TV box /
  Chromecast com Google TV / Fire TV abrindo a mesma URL em navegador moderno ou app kiosk).
- Autostart da TV ao ligar NÃO é prometido; depende de modelo (documentado no checklist).

## R8. Agendamento e fusos
- **Decision**: avaliação no servidor, com `Intl.DateTimeFormat` (sem biblioteca), no fuso da
  unidade da tela. Precisão = intervalo de sincronização (≤ 30 s).
- **Alternatives**: cron/fila (rejeitado: resolução sob demanda dispensa jobs).

## R9. Ruflo, Graphify, Spec Kit, Ponytail
- Spec Kit: CLI oficial `specify` 1.2.1.dev0 instalada; `specify init . --integration claude`.
- Ponytail: aplicado como regra de revisão (comentários `ponytail:` no código).
- Graphify: pacote `graphifyy` para gerar `graphify-out/` sobre o repositório (documentação).
- Ruflo: usado apenas para memória de decisões (`ruflo memory store`); orquestração de enxame
  rejeitada — o trabalho é sequencial e um único agente evita conflitos de código.
