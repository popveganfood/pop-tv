# Feature Specification: POP TV — gestão remota de telas

**Feature Branch**: `001-pop-tv-mvp`
**Created**: 2026-10-14
**Status**: Approved (MVP)
**Input**: User description: "Sistema POP TV para a equipe de marketing do POP Vegan Food atualizar
remotamente o conteúdo das Smart TVs dos restaurantes, eliminando pendrives." (briefing completo do
projeto, seções 1–21)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Parear uma TV e vê-la tocar a programação (Priority: P1)

Um funcionário abre o endereço do player no navegador da Smart TV, que mostra um código temporário.
Um administrador, no painel, clica em "+ Adicionar tela", digita o código, escolhe unidade, ambiente
e nome e confirma. A TV passa a exibir sua programação sozinha, em loop, sem pedir senha.

**Why this priority**: sem TV pareada e tocando, nada mais tem valor.
**Independent Test**: com a unidade de exemplo Consolação e uma playlist de segurança, parear um
navegador desktop e ver o conteúdo em loop.

**Acceptance Scenarios**:
1. **Given** a TV mostra o código, **When** o admin digita o código válido e confirma, **Then** a TV
   sai da tela de código e começa a tocar em até 10 segundos.
2. **Given** um código expirado, já usado ou errado, **When** o admin tenta usá-lo, **Then** o
   sistema recusa com mensagem clara e, após tentativas excessivas, bloqueia temporariamente.
3. **Given** uma TV pareada, **When** o admin revoga o acesso, **Then** a TV deixa de receber
   conteúdo e volta a mostrar um código de pareamento.

### User Story 2 — Biblioteca de mídia e playlists (Priority: P1)

O marketing envia imagens (JPG/PNG/WebP) e vídeos (MP4) arrastando para a biblioteca, organiza em
coleções e etiquetas, monta uma playlist ordenando por arrastar e soltar, define o tempo de cada
imagem (5/10/15/20 s ou personalizado), pré-visualiza e publica.

**Why this priority**: é o conteúdo que substitui o pendrive.
**Independent Test**: enviar 2 imagens e 1 vídeo reais, montar playlist, publicar, ver versão 1.

**Acceptance Scenarios**:
1. **Given** um arquivo PDF renomeado para .jpg, **When** enviado, **Then** é recusado.
2. **Given** um vídeo MP4 que não é H.264, **When** enviado, **Then** é aceito com aviso de
   compatibilidade "atenção".
3. **Given** uma mídia usada numa playlist, **When** alguém tenta excluí-la, **Then** o sistema
   mostra onde é usada e impede a exclusão.
4. **Given** uma playlist publicada várias vezes, **When** o usuário restaura a versão 2, **Then**
   uma nova versão idêntica à 2 é publicada e as TVs a recebem.

### User Story 3 — Publicar em todas, numa unidade, num grupo ou numa TV (Priority: P1)

O marketing escolhe uma playlist e o alvo (todas as unidades, uma unidade, um grupo de telas ou uma
TV) e publica. O painel mostra, por TV, qual regra está definindo o que ela exibe e se a TV já
confirmou o recebimento.

**Why this priority**: situações A–D do briefing.
**Independent Test**: duas TVs pareadas; publicar só na TV 1; TV 2 continua igual.

**Acceptance Scenarios**:
1. **Given** uma regra global e uma regra para a TV de entrada com a mesma prioridade, **When** o
   sistema resolve a programação, **Then** a regra da TV vence (mais específica) e o painel explica.
2. **Given** duas regras com mesma prioridade, mesmo nível de alvo e horários sobrepostos para a
   mesma TV, **When** a segunda é salva, **Then** o sistema recusa e lista o conflito.
3. **Given** uma publicação, **When** a TV ainda não sincronizou, **Then** o painel mostra
   "aguardando TV" (e não "recebido").

### User Story 4 — Agendamento automático (Priority: P2)

O marketing agenda playlists por datas, horários, dias da semana e alvo, com prioridade. Campanhas
temporárias entram e saem do ar sozinhas, voltando à programação anterior. Existe uma playlist
padrão de segurança e uma campanha emergencial com validade obrigatória.

**Independent Test**: agendar playlist "Almoço" 11:00–15:00 seg–sex no fuso da unidade; simular
horários e ver o resultado antes de salvar; observar a troca no player.

**Acceptance Scenarios**:
1. **Given** um agendamento 11:00–15:00 em America/Sao_Paulo, **When** são 10:59 locais, **Then** a
   TV toca a programação base; **When** 11:00, **Then** toca "Almoço" (tolerância ≤ 1 ciclo de
   sincronização).
2. **Given** uma campanha sexta–domingo, **When** chega segunda 00:00 local, **Then** a TV volta à
   programação anterior sem ação humana.
3. **Given** uma emergência sem data de fim, **When** salva, **Then** é recusada.

### User Story 5 — Unidades, ambientes, telas e grupos (Priority: P2)

O administrador cadastra novas unidades ("+ Nova unidade") com endereço, cidade/UF, fuso, contato,
imagem e status; cria/renomeia/reordena/arquiva ambientes; edita, desativa, remove telas; cria
grupos dentro de uma unidade ou entre unidades; arquiva unidades sem perder histórico; duplica
ambientes e regras de outra unidade.

**Independent Test**: criar "Unidade Teste" duplicando a Consolação; ver ambientes copiados.

### User Story 6 — Dashboard e monitoramento (Priority: P2)

A tela inicial mostra contadores reais (unidades, telas, online, offline, campanhas ativas,
playlists publicadas, próximos agendamentos, últimas alterações) e cards de TV por unidade/ambiente
com status, último contato, playlist atual, miniatura, botões Gerenciar, Pré-visualizar e Trocar
programação. Uma TV sem contato além da tolerância aparece offline.

### User Story 7 — Pré-visualização (simulação) (Priority: P3)

Ao selecionar uma TV, o admin abre um simulador 16:9 ou 9:16 que toca a sequência resolvida, com
duração, nome da playlist e da TV, rotulado como SIMULAÇÃO.

### User Story 8 — Usuários e permissões (Priority: P2)

Perfis Administrador geral, Marketing e Gerente de unidade. O gerente só vê suas unidades e só
executa o que o administrador liberou. Toda ação relevante fica no histórico com autor.

**Acceptance Scenarios**:
1. **Given** um gerente da unidade A, **When** chama diretamente a API para editar a unidade B,
   **Then** recebe "sem permissão" (403).

### Edge Cases

- Rede cai: player continua tocando o que já tem em cache; se recarregar offline e o navegador
  suportar cache do aplicativo, volta a tocar o conteúdo salvo.
- Arquivo corrompido ou que não carrega em 15 s: pula e registra erro; se todos falharem, mostra
  tela de marca POP (nunca preta) e tenta de novo.
- Playlist vazia ou nenhuma regra: usa a playlist de segurança; sem ela, tela de marca POP.
- Vídeo que trava: watchdog pula após tempo-limite.
- TV com relógio errado: horário de agendamento é decidido pelo servidor.
- Duas abas do player com o mesmo token: ambas tocam; painel mostra a última que reportou.
- Mídia substituída: drafts passam a usar o novo arquivo; versões publicadas só mudam ao republicar.
- Unidade arquivada: suas TVs param de receber regras de unidade, mas o histórico permanece.
- Navegador sem recursos mínimos (sem vídeo MP4/H.264): o player avisa e sugere player externo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Hierarquia Organização → Unidades → Ambientes → Telas, mais grupos de telas dentro de
  uma unidade ou entre unidades. Nenhuma unidade fixa no código; Consolação vem como dado inicial
  editável.
- **FR-002**: CRUD de unidades com nome, endereço, cidade, UF, fuso horário, contato, imagem,
  ativo/inativo, arquivamento sem perda de histórico e duplicação de ambientes/regras/playlists.
- **FR-003**: CRUD de ambientes com renomear, reordenar e arquivar.
- **FR-004**: Cadastro de telas com unidade, ambiente, nome, fabricante, modelo, orientação, grupos,
  status, desativar, remover e revogar; sem limite fixo de quantidade.
- **FR-005**: Pareamento por código de uso único, validade de 10 minutos, limitação de tentativas;
  credencial própria por TV, revogável e re-pareável remotamente; nunca pedir senha na TV.
- **FR-006**: Biblioteca de mídia com upload individual/múltiplo/arrastar, miniaturas,
  pré-visualização, renomear, etiquetas, coleções editáveis, busca, filtro por tipo, tamanho,
  resolução, duração, substituição, "onde é usada", exclusão segura e reuso entre unidades.
- **FR-007**: Validação de formato pelo conteúdo real do arquivo (não pela extensão), limite de
  tamanho e classificação de compatibilidade (ok / atenção / incompatível).
- **FR-008**: Arquivos nunca acessíveis publicamente; links temporários assinados só para usuários
  autenticados e TVs com credencial válida.
- **FR-009**: Editor de playlist com adicionar, ordenar por arrastar, duplicar item, remover,
  duplicar playlist, rascunho, pré-visualizar, publicar e restaurar versão anterior. Duração de
  imagem 5/10/15/20 s ou personalizada; vídeo toca até o fim.
- **FR-010**: Publicação versionada e imutável; restaurar cria nova versão.
- **FR-011**: Regras de exibição com alvo (todas / unidade / grupo / tela), prioridade (Padrão,
  Campanha, Emergência), período de datas, janela de horário, dias da semana, no fuso da unidade.
- **FR-012**: Resolução determinística: maior prioridade → alvo mais específico (tela > grupo >
  unidade > todas) → mais recente; sem regra, playlist de segurança. Conflitos ambíguos (mesma
  prioridade e mesmo nível, horários sobrepostos, mesma TV) MUST ser recusados ao salvar.
- **FR-013**: Painel mostra para cada TV a regra vencedora, as regras sobrepostas e permite simular
  qualquer data/hora antes de salvar.
- **FR-014**: Emergência exige data/hora de término e vence todas as outras.
- **FR-015**: Player web em tela cheia, sem menus, mudo por padrão, loop, pré-carregamento do
  próximo item, transição sem tela preta, pular item com falha, watchdog, sincronização a cada ~30 s
  baixando somente arquivos novos, cache local quando suportado, detecção e relato de capacidades.
- **FR-016**: Heartbeat com último contato, versão em reprodução, item atual, último erro; status
  offline após tolerância configurável (padrão 90 s).
- **FR-017**: Dashboard com contadores e cards de TV (FR-016) agrupados por unidade/ambiente.
- **FR-018**: Simulador 16:9 e 9:16 rotulado "SIMULAÇÃO".
- **FR-019**: Autenticação por e-mail e senha; perfis Admin, Marketing, Gerente; acesso por unidade;
  todas as checagens no servidor.
- **FR-020**: Histórico de ações (quem, o quê, quando) e lista de "últimas alterações".
- **FR-021**: Interface em português do Brasil, responsiva (celular, tablet, desktop), identidade POP.

### Key Entities

- **Organização**: POP Vegan Food; guarda a playlist de segurança.
- **Unidade**: restaurante; fuso, endereço, contato, imagem, ativo, arquivado.
- **Ambiente**: espaço dentro da unidade; ordem, arquivado.
- **Tela**: TV; unidade, ambiente, orientação, fabricante, modelo, ativa, último estado reportado.
- **Grupo de telas**: conjunto nomeado de telas, opcionalmente ligado a uma unidade.
- **Mídia**: arquivo; tipo, tamanho, resolução, duração, compatibilidade, coleção, etiquetas.
- **Coleção**: agrupamento editável de mídias.
- **Playlist**: rascunho de itens ordenados; versões publicadas imutáveis.
- **Regra de exibição (agendamento/publicação)**: playlist + alvo + prioridade + janela de tempo.
- **Sessão de pareamento** e **Credencial de dispositivo**.
- **Usuário**, **Permissão por unidade**, **Registro de auditoria**.

## Success Criteria *(mandatory)*

- **SC-001**: Parear uma TV leva menos de 2 minutos do código na tela até o conteúdo tocando.
- **SC-002**: Trocar uma promoção (substituir imagem e publicar) leva menos de 6 cliques após abrir
  a playlist.
- **SC-003**: Uma publicação chega à TV online em até 60 s.
- **SC-004**: Nenhum item com falha interrompe a sequência (teste com arquivo inválido).
- **SC-005**: Troca de agendamento ocorre em até 60 s do horário local configurado.
- **SC-006**: 100% das rotas protegidas recusam usuário sem permissão e credencial revogada.
- **SC-007**: Os 20 testes de aceitação do briefing (§18) passam, exceto os que exigem TV física,
  que ficam documentados no checklist.

## Assumptions

- Um único restaurante (Consolação) opera hoje; outras unidades serão cadastradas no painel.
- Agendamentos são avaliados pelo servidor a cada sincronização; offline, a TV mantém o último
  conteúdo resolvido (não troca de agendamento sem rede).
- Áudio desligado por padrão; vídeos com som tocam mudos.
- Capturas reais da tela da TV, métricas de reprodução e apps nativos ficam fora do MVP.
- Gerente pode receber, por usuário, as liberações "gerenciar telas" e "publicar".
- Uma única instância do servidor no MVP.
