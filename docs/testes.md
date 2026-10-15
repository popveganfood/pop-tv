# Resultados dos testes (14/10/2026)

Ambiente: Node 22.22, PostgreSQL 16, Chromium 141 (Playwright, headless), armazenamento local. Comandos: `npm test` (37/37 ✔), `npm run e2e` (15/15 ✔), `npm run e2e:panel` (11/11 ✔), `npm run typecheck` ✔.

## Critérios de aceitação do briefing (§18)

| # | Critério | Onde é testado | Status |
|---|---|---|---|
| 1 | Criar unidade | publish.test "unidade e ambientes"; e2e 1–2; panel "Criar nova unidade" | ✔ |
| 2 | Criar ambientes | idem | ✔ |
| 3 | Cadastrar e parear duas TVs | pairing.test; e2e 3 (2 navegadores); panel "Adicionar tela" | ✔ |
| 4 | Enviar imagens e vídeos reais | publish.test upload; e2e 4; panel "Enviar imagem e vídeo" | ✔ |
| 5 | Montar playlist | publish.test; e2e 5–6; panel "Montar playlist" | ✔ |
| 6 | Visualizar antes de publicar | e2e 5–6 (rascunho com URLs); panel "Pré-visualizar" (simulador) | ✔ |
| 7 | Publicar só numa TV | publish.test (TV 02 não muda); e2e 7 | ✔ |
| 8 | Publicar num grupo | publish.test; e2e 8 | ✔ |
| 9 | Publicar em todas as unidades autorizadas | publish.test (global + marketing limitado recebe 403); e2e 9 | ✔ |
| 10 | Player detecta nova versão | publish.test; e2e 7 e 9 | ✔ |
| 11 | Loop | e2e 10–11 (sequência observada volta ao início) | ✔ |
| 12 | TV desconectada aparece offline | pairing.test; e2e 12 | ✔ |
| 13 | Conteúdo local sem internet | e2e 13: servidor desligado + página recarregada → continua tocando do cache | ✔ (Chromium; TV real: checklist) |
| 14 | Arquivo inválido não trava | inspect.test (recusa no envio); e2e 14 (arquivo corrompido é pulado e o erro é registrado) | ✔ |
| 15 | Agendamento começa e termina no horário | schedule.test (fuso, janela, sexta→domingo, meia-noite) | ✔ |
| 16 | Restaurar programação anterior | publish.test; e2e 16 | ✔ |
| 17 | Gerente sem permissão bloqueado | publish.test "permissões" (chamadas diretas à API) | ✔ |
| 18 | Credencial revogada sem acesso | pairing.test; e2e 18 | ✔ |
| 19 | Funciona em navegador desktop | e2e e panel (Chromium) | ✔ |
| 20 | Limitações de TVs documentadas | `docs/checklist-tv.md` | ✔ documentado · **teste físico pendente** |

## O que NÃO foi testado ainda
- Smart TVs físicas (Samsung/LG/Android TV): obrigatório antes de aprovar compatibilidade.
- Reprodução de H.264: o Chromium de teste não tem o codec; validado só o reconhecimento do arquivo.
- R2 e Supabase reais: os testes usam Postgres local e armazenamento local com o mesmo protocolo de URL assinada. O driver R2 (assinatura SigV4, cópia de objeto) precisa de um teste com as credenciais reais após a configuração.
- Carga com dezenas de TVs simultâneas (estimativa de custo em `docs/custos.md`).
