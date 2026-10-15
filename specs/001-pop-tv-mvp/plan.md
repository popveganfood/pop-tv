# Implementation Plan: POP TV MVP

**Branch**: `001-pop-tv-mvp` | **Date**: 2026-10-14 | **Spec**: specs/001-pop-tv-mvp/spec.md

## Summary
Uma aplicação Node/TypeScript (Fastify) que serve a API, o painel React e o player ES5 na mesma
origem; PostgreSQL para dados; Cloudflare R2 para mídia com URLs assinadas. TVs pareiam por código,
sincronizam a cada 30 s e tocam a playlist resolvida pelas regras de exibição.

## Technical Context
- **Language/Version**: Node.js ≥ 22.18 (TypeScript por type-stripping nativo, sem build no servidor);
  TypeScript 5.9 só para checagem (`tsc --noEmit`); player em JavaScript ES5.
- **Primary Dependencies**: fastify, @fastify/cookie, @fastify/static, pg, aws4fetch; painel: react,
  vite, tailwindcss, @fontsource/poppins.
- **Storage**: PostgreSQL (Supabase); Cloudflare R2 (driver `local` só em dev/test).
- **Testing**: `node:test` + `app.inject` com Postgres real (banco descartável por arquivo de teste);
  e2e com Playwright (Chromium pré-instalado).
- **Target Platform**: Railway (Linux); navegadores de Smart TV (Tizen, webOS, Android/Google TV) e
  desktop.
- **Project Type**: web (backend + frontend + player estático) num único pacote.
- **Performance Goals**: sync < 50 ms no servidor; 50 TVs ≈ 1,7 req/s.
- **Constraints**: sem custo por TV; vídeos nunca pelo backend; 1 instância.
- **Scale/Scope**: até ~50 TVs, ~10 usuários, biblioteca de alguns GB.

## Constitution Check
| Princípio | Status | Como |
|---|---|---|
| I Player primeiro | ✅ | duas camadas com pré-carregamento, watchdog, pular falhas, tela de marca, cache |
| II Simplicidade | ✅ | 1 serviço, SQL puro, sem ORM/Redis/WS; auth nativa; regras = 1 tabela |
| III Segurança no servidor | ✅ | guards por rota, tokens com hash, URL assinada, rate limit, CSRF por content-type |
| IV Dados reais | ✅ | "publicado" vs "recebido" separados; simulador rotulado |
| V Identidade POP | ✅ | tokens do Design System POP em `web/src/theme.css` |
| VI pt-BR | ✅ | toda UI e mensagens |
| VII Custo | ✅ | estimativas em docs/custos.md; nada pago ativado |

Reavaliado após o design: sem violações.

## Project Structure
```text
specs/001-pop-tv-mvp/   spec, plan, research, data-model, contracts/, quickstart, tasks
server/
  migrations/           001_init.sql, 002_seed.sql
  src/
    index.ts            boot (migra, cria admin inicial, escuta)
    app.ts              monta Fastify, estáticos, rotas
    config.ts  db.ts  auth.ts  audit.ts  ratelimit.ts
    storage.ts          drivers r2 | local (URL assinada)
    inspect.ts          valida bytes e extrai metadados (JPG/PNG/WebP/MP4)
    schedule.ts         resolução de regras, conflitos, fuso (funções puras)
    resolver.ts         snapshot em memória + manifesto por tela
    routes/             auth, org, media, playlists, schedules, dashboard, player, devstorage
  test/                 *.test.ts
web/                    painel React (Vite) → web/dist
player/                 index.html, player.js, sw.js (ES5, sem build)
e2e/                    acceptance.mjs (Playwright)
docs/                   arquitetura, deploy, manuais, checklist TV, custos
```

## Complexity Tracking
| Item | Por que | Alternativa simples rejeitada |
|---|---|---|
| Service Worker no player | único jeito de tocar offline após recarregar a página | sem SW: TV recarregada sem rede ficaria sem conteúdo |
| Snapshot em memória das regras | economizar egress do Supabase Free com polling de 50 TVs | consultar o banco a cada sync (~4 GB/mês de egress) |
