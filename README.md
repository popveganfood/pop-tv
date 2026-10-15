# POP TV

Sistema próprio de gestão remota das TVs do **POP Vegan Food**. A equipe de marketing envia imagens e vídeos, monta playlists, escolhe onde e quando cada uma passa e publica pela internet — sem pendrive.

- **Painel** (`/`): React + Tailwind com a identidade POP (Vermerosa `#da3250`, Preto, Laranja `#f79433`, Branco, Poppins, logotipo oficial).
- **Player das TVs** (`/tv`): JavaScript ES5 sem build, feito para navegadores de Smart TV. Toca em loop, pré-carrega, pula arquivos com falha, guarda mídia para funcionar sem internet quando o navegador permite.
- **Servidor** (`/api`): Node.js + Fastify + PostgreSQL. Arquivos no Cloudflare R2 por URL assinada (vídeos nunca passam pelo servidor).

Tudo roda num único serviço (um deploy no Railway).

## Como funciona em 30 segundos

1. Na TV, abra `https://SEU-DOMINIO/tv` → aparece um código de 6 letras.
2. No painel: **Telas → + Adicionar tela**, digite o código, escolha unidade e ambiente.
3. **Mídia** → arraste arquivos. **Playlists** → monte a sequência → **Publicar**.
4. **Programação** → escolha a playlist, onde (todas / unidade / grupo / uma TV), quando e a prioridade.
5. A TV troca em até 30 s. O card da TV mostra **"TV confirmou"** quando ela de fato recebeu.

Regra de decisão (sempre visível no painel em *Gerenciar → O que está tocando*):
**Emergência > Campanha > Padrão**; empate → alvo mais específico (**tela > grupo > unidade > todas**); empate → mais recente. Nada ativo → **playlist de segurança**. Conflitos ambíguos são recusados ao salvar.

## Rodar localmente

Pré-requisitos: Node ≥ 22.18 e um PostgreSQL (local ou Supabase).

```bash
npm install
cp .env.example .env      # ajuste DATABASE_URL e ADMIN_EMAIL/ADMIN_PASSWORD
npm run build             # gera o painel em web/dist
npm run dev               # http://localhost:3000 (painel) e /tv (player)
```

`NODE_ENV=development` no `.env` libera o armazenamento local (`STORAGE_DRIVER=local`). Sem isso o servidor se comporta como produção e exige R2 e `APP_SECRET`.

Para editar o painel com recarga instantânea: `npm run dev` num terminal e `npm run dev:web` em outro (porta 5173, com proxy para a API).

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor com recarga automática |
| `npm run build` | build do painel |
| `npm start` | produção (`node server/src/index.ts`; aplica migrações ao subir) |
| `npm run migrate` | só aplica migrações |
| `npm run create-admin -- email "Nome"` | cria/redefine um administrador |
| `npm test` | 37 testes unitários e de integração (Postgres real) |
| `npm run e2e` | aceitação ponta a ponta: servidor + 2 TVs em Chromium |
| `npm run e2e:panel` | fluxos do painel por cliques reais |
| `npm run typecheck` | checagem de tipos |

## Estrutura

```
server/   API (src/), migrações SQL (migrations/), testes (test/)
web/      painel React (src/pages/*, ui.tsx = componentes, theme.css = tokens da marca)
player/   player das TVs: index.html, player.js, sw.js
e2e/      testes de aceitação com navegador
specs/    Spec Kit: spec, plano, pesquisa, modelo de dados, contrato da API, tarefas
docs/     arquitetura, implantação, segurança, custos, manuais e checklist de TVs
graphify-out/  grafo de conhecimento do código (graph.html, GRAPH_REPORT.md)
```

## Documentação

- [Arquitetura](docs/arquitetura.md) · [Implantação (Supabase, R2, Railway)](docs/implantacao.md) · [Segurança](docs/seguranca.md) · [Custos](docs/custos.md)
- [Manual: cadastrar unidades](docs/manual-unidades.md) · [Manual: parear TVs](docs/manual-parear-tvs.md) · [Guia para funcionários](docs/guia-funcionarios.md)
- [Checklist de testes em Smart TVs](docs/checklist-tv.md) · [Resultados dos testes](docs/testes.md)
- Spec Kit: [constituição](.specify/memory/constitution.md) · [especificação](specs/001-pop-tv-mvp/spec.md) · [plano](specs/001-pop-tv-mvp/plan.md) · [tarefas](specs/001-pop-tv-mvp/tasks.md)

## Ferramentas de desenvolvimento usadas

- **Spec Kit** (CLI oficial `specify` 1.2.1.dev0): constituição → spec → plano → tarefas → implementação → convergência.
- **Ponytail**: regra de simplicidade; limites conscientes marcados no código com `ponytail:`.
- **Graphify** (`graphifyy` 0.9.90): grafo do código em `graphify-out/` — atualize com `graphify update .`.
- **Ruflo** (3.56.10): memória de decisões (`ruflo memory search --query "..."`). A orquestração em enxame não foi usada: o trabalho era sequencial e um agente único evita conflitos de código. Uma revisão de segurança independente foi feita por um subagente; os 12 achados foram corrigidos ou documentados.
