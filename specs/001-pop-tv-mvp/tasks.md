# Tasks: POP TV MVP

**Input**: specs/001-pop-tv-mvp/ (plan.md, spec.md, data-model.md, contracts/api.md, research.md)
**Tests**: exigidos pela spec (§18 do briefing) para permissões, agendamento, publicação e pareamento.

## Phase 1: Setup
- [x] T001 Criar package.json, tsconfig.json, .gitignore, .env.example na raiz
- [x] T002 [P] Configurar Vite + React + Tailwind em web/ (web/vite.config.ts, web/index.html)
- [x] T003 [P] Iniciar Postgres local de desenvolvimento e script de teste (scripts/dev-db.sh)

## Phase 2: Foundational (bloqueia todas as histórias)
- [x] T004 Migrações SQL server/migrations/001_init.sql e 002_seed.sql
- [x] T005 Pool, transações e executor de migrações em server/src/db.ts
- [x] T006 Configuração por ambiente em server/src/config.ts (proíbe storage local em produção)
- [x] T007 Senhas scrypt, sessões, guards e escopo por unidade em server/src/auth.ts
- [x] T008 [P] Rate limiter em memória em server/src/ratelimit.ts
- [x] T009 [P] Auditoria em server/src/audit.ts
- [x] T010 Montagem do app (cookies, estáticos, erros pt-BR, CSRF) em server/src/app.ts e server/src/index.ts
- [x] T011 Rotas de login/logout/me e usuários em server/src/routes/auth.ts
- [x] T012 Harness de testes com banco descartável em server/test/helpers.ts
**Checkpoint**: login funcionando e testado.

## Phase 3: US1 — Parear TV e tocar (P1) 🎯 MVP
- [x] T013 [US1] Teste de pareamento (código único, expiração, tentativas, revogação) em server/test/pairing.test.ts
- [x] T014 [US1] Rotas de unidades/ambientes/telas/grupos em server/src/routes/org.ts
- [x] T015 [US1] Rotas do player (pair/start, pair/poll, sync) em server/src/routes/player.ts
- [x] T016 [US1] Claim/repair/revoke em server/src/routes/org.ts
- [x] T017 [US1] Player ES5: pareamento, duas camadas, pré-carga, watchdog em player/player.js e player/index.html
- [x] T018 [US1] Service Worker com cache e Range em player/sw.js

## Phase 4: US2 — Mídia e playlists (P1)
- [x] T019 [US2] Testes de inspeção de arquivos em server/test/inspect.test.ts
- [x] T020 [P] [US2] Validação/metadados JPG/PNG/WebP/MP4 em server/src/inspect.ts
- [x] T021 [P] [US2] Drivers r2/local com URL assinada em server/src/storage.ts e server/src/routes/devstorage.ts
- [x] T022 [US2] Rotas de mídia e coleções em server/src/routes/media.ts
- [x] T023 [US2] Rotas de playlist, publicação e restauração em server/src/routes/playlists.ts
- [x] T024 [US2] Testes de mídia e versões em server/test/media-playlists.test.ts

## Phase 5: US3 + US4 — Regras de exibição e agendamento (P1/P2)
- [x] T025 [US4] Testes de resolução, fuso, virada de meia-noite e conflitos em server/test/schedule.test.ts
- [x] T026 [US4] Funções puras de resolução/conflito em server/src/schedule.ts
- [x] T027 [US3] Snapshot em memória e manifesto por tela em server/src/resolver.ts
- [x] T028 [US3] Rotas de schedules, check, resolve e calendar em server/src/routes/schedules.ts
- [x] T029 [US3] Testes de publicação por alvo e permissões em server/test/publish.test.ts

## Phase 6: US5–US8 — Painel
- [x] T030 [US6] Dashboard API em server/src/routes/dashboard.ts
- [x] T031 [P] Sistema de design POP (tokens, componentes) em web/src/theme.css e web/src/ui.tsx
- [x] T032 Shell (menu lateral, cabeçalho, roteador, toasts) em web/src/App.tsx
- [x] T033 [US6] Dashboard em web/src/pages/Dashboard.tsx
- [x] T034 [US5] Unidades e ambientes em web/src/pages/Units.tsx
- [x] T035 [US1] Telas, pareamento e grupos em web/src/pages/Screens.tsx
- [x] T036 [US2] Biblioteca de mídia em web/src/pages/Media.tsx
- [x] T037 [US2] Editor de playlists em web/src/pages/Playlists.tsx
- [x] T038 [US4] Programação e calendário em web/src/pages/Schedules.tsx
- [x] T039 [US7] Simulador em web/src/Preview.tsx
- [x] T040 [US8] Usuários e histórico em web/src/pages/Users.tsx

## Phase 7: Polish & cross-cutting
- [x] T041 Teste e2e com 2 TVs em e2e/acceptance.mjs
- [x] T042 [P] Documentação em README.md e docs/
- [x] T043 [P] Grafo Graphify em graphify-out/
- [x] T044 Revisão de segurança e /speckit-converge

## Dependencies
Setup → Foundational → US1 → US2 → US3/US4 → Painel → Polish. T020/T021 paralelos; T031 paralelo às rotas.

## Implementation Strategy
MVP = Phases 1–3 (TV pareada tocando a playlist de segurança). Depois incremental: mídia/playlists,
regras, painel completo, e2e e documentação.

## Phase 8: Convergence (2026-10-14, /speckit-converge)
Comparação código × spec após a implementação. Desvios conscientes: heartbeats sem histórico (só último estado + erros); entidades `publication_targets` fundidas em `schedules`; Supabase Auth substituído por autenticação própria (research R3).
- [x] T045 Corrigir achados da revisão de segurança (12) em server/src/* e player/*
- [ ] T046 Configurar Supabase, R2 (CORS) e Railway com as credenciais do POP (aguarda autorização) — docs/implantacao.md
- [ ] T047 Teste do driver R2 com bucket real (upload, cópia, leitura assinada, CORS) — server/src/storage.ts
- [ ] T048 Teste em Smart TVs físicas da Consolação — docs/checklist-tv.md
- [ ] T049 Publicar conteúdo institucional real do POP na playlist "Segurança POP"
- [ ] T050 (futuro) Limpeza de arquivos órfãos no R2 após substituições
