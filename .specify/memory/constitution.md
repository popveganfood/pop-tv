<!--
Sync Impact Report
- Version: (template) → 1.0.0
- Principles added: I Player primeiro, II Simplicidade (Ponytail), III Segurança no servidor, IV Dados reais, V Marca POP, VI Português do Brasil, VII Custo consciente
- Sections added: Restrições adicionais, Fluxo de desenvolvimento, Governança
- Templates: plan-template (Constitution Check) — ok, verificado manualmente; spec/tasks — ok
- TODOs: nenhum
-->
# POP TV Constitution

## Core Principles

### I. Player primeiro (NÃO NEGOCIÁVEL)
O reprodutor das TVs MUST continuar exibindo conteúdo quando a rede, o servidor, um arquivo ou uma
publicação falharem. Nenhuma alteração pode fazer o player exibir tela preta, travar ou duplicar a
reprodução. Falha de um item MUST pular para o próximo e ser registrada.
*Justificativa*: a TV é usada pela operação do restaurante todos os dias; um painel bonito com TV
apagada é falha total.

### II. Simplicidade deliberada (Ponytail)
Uma aplicação, um serviço, um banco. Recursos nativos (navegador, PostgreSQL, Node) antes de
dependências. Nada de microsserviços, Redis, filas, WebSockets ou streaming sem necessidade medida.
Toda simplificação com teto conhecido MUST ter um comentário `ponytail:` dizendo o limite e o caminho
de evolução.
*Justificativa*: manutenção simples por uma equipe pequena e custo baixo.

### III. Segurança decidida no servidor
Toda permissão MUST ser verificada no backend; a interface apenas esconde. Segredos ficam só em
variáveis de ambiente. Nenhuma credencial administrativa ou de armazenamento no player ou no
frontend. Cada TV tem credencial própria e revogável. Exclusões irreversíveis exigem confirmação.
*Justificativa*: o painel será usado por pessoas não técnicas e as TVs ficam em local público.

### IV. Dados reais e honestos
O painel MUST mostrar somente dados reais da aplicação. "Publicado no servidor" e "recebido pela TV"
são estados distintos e MUST aparecer separados. Simulação MUST ser rotulada como simulação.
Nada é marcado como concluído sem teste executado.

### V. Identidade POP
A interface MUST usar o sistema de design oficial do POP (Vermerosa #da3250, Preto #000000,
Laranja #f79433, Branco #ffffff, tipografia Poppins, logotipo oficial). Tokens ficam centralizados
em um único arquivo substituível.

### VI. Português do Brasil
Toda interface, mensagem de erro e documentação para usuários MUST estar em português do Brasil,
com linguagem simples para equipe de marketing e funcionários.

### VII. Custo consciente
Preferir planos gratuitos e ferramentas open source; nenhuma cobrança por TV. Qualquer recurso que
possa gerar cobrança MUST ser sinalizado antes de ser ativado. Deploy pago ou destrutivo só com
autorização explícita.

## Restrições adicionais

- Stack: Node.js ≥ 22.18 + TypeScript (executado por type-stripping nativo), Fastify, PostgreSQL
  (Supabase ou qualquer Postgres), Cloudflare R2 (S3), React + Vite + Tailwind no painel,
  JavaScript ES5 sem build no player (compatibilidade com navegadores antigos de TV).
- Hospedagem: um único serviço no Railway servindo API, painel e player na mesma origem.
- Unidades, ambientes, horários e telas nunca fixos no código; tudo cadastrável pelo painel.
- Arquivos de mídia nunca passam pelo backend em produção (upload/download direto no R2 por URL
  assinada).

## Fluxo de desenvolvimento

Spec Kit: constitution → specify → plan → tasks → implement → converge. Cada fase entregue com
testes executados e resultado registrado. Regras críticas (permissões, agendamento, publicação,
pareamento) MUST ter testes automatizados. Compatibilidade com TV física só é aprovada após teste
em aparelho real (checklist em `docs/checklist-tv.md`).

## Governança

Esta constituição prevalece sobre preferências de implementação. Emendas: alterar este arquivo,
incrementar versão (MAJOR remove/redefine princípio; MINOR adiciona; PATCH redação) e registrar no
Sync Impact Report. Toda revisão de código verifica os princípios I–VII; violações exigem
justificativa em "Complexity Tracking" do plano.

**Version**: 1.0.0 | **Ratified**: 2026-10-14 | **Last Amended**: 2026-10-14
