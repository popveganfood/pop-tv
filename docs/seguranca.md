# Segurança

## O que está implementado

| Tema | Como |
|---|---|
| Permissões | Conferidas no servidor em toda rota (`server/src/auth.ts`). Admin: tudo. Marketing: mídia, playlists e publicação só nas unidades autorizadas (todas exige "acesso a todas"). Gerente: vê só as suas unidades; liberações extras por usuário (gerenciar telas, trocar programação). Testado em `server/test/publish.test.ts` e `hardening.test.ts`. |
| Senhas | `scrypt` com sal, comparação em tempo constante, mesma resposta para e-mail inexistente e senha errada. |
| Sessões | token aleatório (só o hash no banco), cookie `HttpOnly`, `Secure` em produção, `SameSite=Lax`, 14 dias; trocar senha ou bloquear usuário encerra as sessões. |
| CSRF | escrita só com `Content-Type: application/json` + `SameSite=Lax`. |
| Limite de tentativas | login (10/min por IP, 20/15 min por e-mail), código de pareamento (10/10 min por usuário, 30 por IP), criação de códigos (20/10 min por IP). IP real considera só o proxy do Railway. |
| TVs | sem senha na TV; credencial própria por tela (hash no banco), entregue uma vez, revogável; código de 6 letras, 10 min, uso único. |
| Arquivos | bucket privado; URLs assinadas (envio 15 min, leitura 3 dias); envio para chave de rascunho e cópia para a chave final só após validação dos bytes; formatos e tamanhos limitados. |
| Banco | só o servidor acessa; SQL sempre parametrizado; integridade referencial (mídia em uso não pode ser apagada). |
| Exclusões | confirmação explícita no painel; unidades são arquivadas (nunca apagadas); mídia é exclusão lógica. |
| Auditoria | `audit_logs`: quem fez o quê e quando (inclui quem publicou cada campanha). |
| Cabeçalhos | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` no painel. |
| Configuração | servidor recusa iniciar com `APP_SECRET` fraco, armazenamento local ou sem credenciais R2 em produção. |

## Revisão independente

Uma revisão de segurança feita por um subagente encontrou 12 pontos (nenhum crítico). Corrigidos: downloads duplicados no player, spoof de `X-Forwarded-For`, URL de envio reaproveitável, TV revogada voltando a tocar, configuração aberta sem `NODE_ENV`, snapshot desatualizado gerando 401, grupos entre unidades, mudança de unidade mantendo grupos antigos, vídeo pausado travando a tela, data inválida no calendário e limite de upload local. Documentado sem correção: o Service Worker lê o arquivo inteiro do cache em cada pedido `Range` — em TVs com pouca memória, use vídeos curtos (até ~100 MB) e acompanhe no diagnóstico.

## Boas práticas para a equipe

- Cada pessoa com seu usuário; nada de senha compartilhada.
- Gerentes só com as liberações necessárias.
- Ao trocar uma TV de lugar ou descartá-la: **Gerenciar → Pareamento e acesso → Revogar**.
- Troque `APP_SECRET` e as chaves R2 se suspeitar de vazamento (as TVs continuam pareadas; uploads em andamento falham).
- Não coloque informações pessoais de clientes em mídias.
