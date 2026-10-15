# Graph Report - pop-tv  (2026-10-14)

## Corpus Check
- 67 files · ~54,477 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 3, .woff2 2, .example 1)

## Summary
- 654 nodes · 1830 edges · 35 communities (31 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `641f00c0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ui.tsx
- acceptance.mjs
- storage.ts
- player.js
- 001_init.sql
- src/auth.ts
- schedule.ts
- helpers.ts
- User Scenarios & Testing *(mandatory)*
- panel.mjs
- package.json
- deploy
- Implantação: Supabase + Cloudflare R2 + Railway
- devDependencies
- compilerOptions
- compilerOptions
- scripts
- Contrato da API — POP TV
- Tasks: POP TV MVP
- Manual: parear uma TV
- Implementation Plan: POP TV MVP
- dependencies
- Data Model — POP TV
- Arquitetura
- main.tsx
- engines
- quickstart.md
- Checklist de testes em Smart TVs
- POP TV
- Estimativa de custos
- Guia rápido para a equipe do POP
- README.md
- Manual: cadastrar uma nova unidade
- Segurança

## God Nodes (most connected - your core abstractions)
1. `get()` - 35 edges
2. `Button()` - 34 edges
3. `q()` - 30 edges
4. `PlaylistEditor()` - 30 edges
5. `scheduleRoutes()` - 29 edges
6. `useLoad()` - 29 edges
7. `post()` - 26 edges
8. `one()` - 25 edges
9. `orgRoutes()` - 25 edges
10. `Card()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `Grafo de conhecimento` --references--> `orgRoutes()`  [INFERRED]
  docs/arquitetura.md → server/src/routes/org.ts
- `Grafo de conhecimento` --references--> `scheduleRoutes()`  [INFERRED]
  docs/arquitetura.md → server/src/routes/schedules.ts
- `R6. Cache offline no player` --references--> `localStorage()`  [INFERRED]
  specs/001-pop-tv-mvp/research.md → server/src/storage.ts
- `R7. Compatibilidade de TVs` --references--> `localStorage()`  [INFERRED]
  specs/001-pop-tv-mvp/research.md → server/src/storage.ts
- `Grafo de conhecimento` --references--> `PlaylistEditor()`  [INFERRED]
  docs/arquitetura.md → web/src/pages/Playlists.tsx

## Import Cycles
- None detected.

## Communities (35 total, 4 thin omitted)

### Community 0 - "ui.tsx"
Cohesion: 0.10
Nodes (104): react, api(), ApiError, del(), get(), onUnauthorized(), patch(), post() (+96 more)

### Community 1 - "acceptance.mjs"
Cohesion: 0.13
Nodes (15): a, api(), assert(), dbUrl, failed, fx(), results, sleep() (+7 more)

### Community 2 - "storage.ts"
Cohesion: 0.06
Nodes (31): aws4fetch, Box, boxes(), imageSize(), inspect(), INSPECT_BYTES, Inspection, Kind (+23 more)

### Community 3 - "player.js"
Cohesion: 0.18
Nodes (27): advance(), applyOrientation(), applyPending(), clearTimers(), emptyLayer(), fail(), idle(), log() (+19 more)

### Community 4 - "001_init.sql"
Cohesion: 0.13
Nodes (32): audit_logs, audit_logs_created_idx, collections, device_credentials, device_credentials_screen_idx, device_logs, device_logs_screen_idx, environments (+24 more)

### Community 5 - "src/auth.ts"
Cohesion: 0.06
Nodes (102): fastify, buildApp(), root(), audit(), assertAdmin(), assertContent(), assertManageScreens(), assertPublish() (+94 more)

### Community 6 - "schedule.ts"
Cohesion: 0.16
Nodes (21): activeAtLocal(), blocks(), compareRules(), findConflicts(), fmtNaive(), localNaive(), minutesOf(), naive() (+13 more)

### Community 7 - "helpers.ts"
Cohesion: 0.19
Nodes (9): CONSOLACAO, FALLBACK, fixture(), setup(), api(), login(), pairTv(), upload() (+1 more)

### Community 8 - "User Scenarios & Testing *(mandatory)*"
Cohesion: 0.09
Nodes (21): Content Quality, Feature Readiness, Notes, Requirement Completeness, Specification Quality Checklist: POP TV MVP, Assumptions, Edge Cases, Feature Specification: POP TV — gestão remota de telas (+13 more)

### Community 9 - "panel.mjs"
Cohesion: 0.12
Nodes (9): a, dbUrl, jsErrors, page, results, server, tv, pg (+1 more)

### Community 10 - "package.json"
Cohesion: 0.12
Nodes (17): description, name, private, type, version, @fastify/cookie, @fastify/static, @fontsource/poppins (+9 more)

### Community 11 - "deploy"
Cohesion: 0.17
Nodes (11): build, buildCommand, builder, deploy, healthcheckPath, healthcheckTimeout, numReplicas, restartPolicyMaxRetries (+3 more)

### Community 12 - "Implantação: Supabase + Cloudflare R2 + Railway"
Cohesion: 0.25
Nodes (7): 1. Banco — Supabase (plano Free), 2. Arquivos — Cloudflare R2, 3. Aplicação — Railway, 4. Primeiro acesso, Desenvolvimento × produção, Implantação: Supabase + Cloudflare R2 + Railway, Processo de publicação (deploy)

### Community 13 - "devDependencies"
Cohesion: 0.14
Nodes (14): devDependencies, @fontsource/poppins, playwright-core, react, react-dom, tailwindcss, @tailwindcss/vite, @types/node (+6 more)

### Community 14 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, module, moduleResolution, noEmit, skipLibCheck, strict (+4 more)

### Community 15 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleResolution, noEmit, skipLibCheck (+4 more)

### Community 16 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, create-admin, dev, dev:web, e2e, e2e:panel, migrate (+3 more)

### Community 17 - "Contrato da API — POP TV"
Cohesion: 0.18
Nodes (10): Autenticação (`/api/auth`), Contrato da API — POP TV, Dashboard, Mídia, Organização, Pareamento (painel), Player (TV) — sem sessão de usuário, Playlists (+2 more)

### Community 19 - "Tasks: POP TV MVP"
Cohesion: 0.18
Nodes (11): Dependencies, Implementation Strategy, Phase 1: Setup, Phase 2: Foundational (bloqueia todas as histórias), Phase 3: US1 — Parear TV e tocar (P1) 🎯 MVP, Phase 4: US2 — Mídia e playlists (P1), Phase 5: US3 + US4 — Regras de exibição e agendamento (P1/P2), Phase 6: US5–US8 — Painel (+3 more)

### Community 20 - "Manual: parear uma TV"
Cohesion: 0.25
Nodes (7): Conferir, Manual: parear uma TV, Na TV, No painel (celular ou computador), Se a TV ligar e não abrir sozinha, Tela cheia, Trocar a TV, mover ou remover

### Community 21 - "Implementation Plan: POP TV MVP"
Cohesion: 0.29
Nodes (6): Complexity Tracking, Constitution Check, Implementation Plan: POP TV MVP, Project Structure, Summary, Technical Context

### Community 22 - "dependencies"
Cohesion: 0.33
Nodes (6): dependencies, aws4fetch, fastify, @fastify/cookie, @fastify/static, pg

### Community 23 - "Data Model — POP TV"
Cohesion: 0.40
Nodes (4): Data Model — POP TV, Estados, Mapeamento com as entidades sugeridas no briefing, Regras de validação principais

### Community 24 - "Arquitetura"
Cohesion: 0.29
Nodes (6): Arquitetura, Decisões de simplicidade (Ponytail) e seus limites, Fluxos principais, Grafo de conhecimento, Módulos, Prioridade e conflitos

### Community 28 - "Checklist de testes em Smart TVs"
Cohesion: 0.29
Nodes (6): Antes, Checklist de testes em Smart TVs, Limitações conhecidas (documentadas, não prometidas), Quando o navegador da TV não serve, Registro, Testes

### Community 29 - "POP TV"
Cohesion: 0.29
Nodes (7): Como funciona em 30 segundos, Documentação, Estrutura, Ferramentas de desenvolvimento usadas, POP TV, Rodar localmente, Scripts

### Community 30 - "Estimativa de custos"
Cohesion: 0.33
Nodes (5): Estimativa de custos, Estimativa mensal, Premissas, Preços usados, Quando passa a custar

### Community 31 - "Guia rápido para a equipe do POP"
Cohesion: 0.33
Nodes (5): Guia rápido para a equipe do POP, Na TV (funcionários do salão), O que significam os avisos, Programar uma campanha (sexta a domingo, por exemplo), Trocar uma promoção (marketing)

### Community 32 - "README.md"
Cohesion: 0.33
Nodes (3): Critérios de aceitação do briefing (§18), O que NÃO foi testado ainda, Resultados dos testes (14/10/2026)

### Community 33 - "Manual: cadastrar uma nova unidade"
Cohesion: 0.40
Nodes (4): Acesso de pessoas à unidade, Atalho: copiar de outra unidade, Ativa, inativa e arquivada, Manual: cadastrar uma nova unidade

### Community 34 - "Segurança"
Cohesion: 0.40
Nodes (4): Boas práticas para a equipe, O que está implementado, Revisão independente, Segurança

## Knowledge Gaps
- **8 isolated node(s):** `@fontsource/poppins`, `@types/node`, `@types/pg`, `@types/react`, `@types/react-dom` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 273 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Grafo de conhecimento` connect `Arquitetura` to `ui.tsx`, `src/auth.ts`?**
  _High betweenness centrality (0.288) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `scheduleRoutes()` (e.g. with `Grafo de conhecimento` and `buildApp()`) actually correct?**
  _`scheduleRoutes()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@fontsource/poppins`, `@types/node`, `@types/pg` to the rest of the system?**
  _8 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ui.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.1035956380783967 - nodes in this community are weakly interconnected._
- **Why does `react` connect `ui.tsx` to `package.json`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Should `acceptance.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.12631578947368421 - nodes in this community are weakly interconnected._
- **Should `storage.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05851063829787234 - nodes in this community are weakly interconnected._