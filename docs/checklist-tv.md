# Checklist de testes em Smart TVs

A compatibilidade com uma TV só é aprovada depois deste teste no aparelho real. Os testes automatizados rodam em Chromium de computador (sem H.264 — por isso os testes de vídeo usam VP9; H.264 depende do aparelho).

## Antes
- [ ] TV com firmware atualizado e internet estável.
- [ ] Anotar: fabricante, modelo, ano, sistema (Tizen/webOS/Android TV/Google TV), versão do navegador.
- [ ] Endereço do player em **HTTPS** (sem HTTPS não há cache offline).

## Testes
| # | Teste | Como | Resultado |
|---|---|---|---|
| 1 | Abre o player | `https://…/tv` mostra o código grande e legível a 3 m | |
| 2 | Pareamento | código aceito no painel; TV sai do código em < 10 s | |
| 3 | Capacidades | painel → Gerenciar → Diagnóstico: anotar H.264, Cache offline, SW ativo, Tela cheia | |
| 4 | Tela cheia | OK no controle entra em tela cheia (ou usar menu do navegador) | |
| 5 | Imagem JPG/PNG/WebP | exibe sem distorção, tempo correto | |
| 6 | Vídeo MP4 H.264 1080p | toca mudo até o fim, sem travar | |
| 7 | Transições | imagem→vídeo, vídeo→imagem, vídeo→vídeo sem tela preta prolongada (anotar se houver piscada) | |
| 8 | Loop | deixar 2 h: sequência continua, sem travar | |
| 9 | Nova publicação | publicar v2: troca em ≤ 60 s, painel mostra "TV confirmou" | |
| 10 | Agendamento | regra começando em 2 min: troca no horário (± 30 s) | |
| 11 | Arquivo ruim | playlist com um item com problema: item é pulado, erro aparece no diagnóstico | |
| 12 | Queda de internet | desligar o roteador 5 min: continua tocando; painel mostra offline após 90 s | |
| 13 | Recarregar sem internet | sem internet, fechar e reabrir o navegador no endereço: volta a tocar (só se Cache offline = sim) | |
| 14 | Volta da internet | religar o roteador: TV volta online sozinha | |
| 15 | Revogar | revogar no painel: TV volta ao código em ≤ 30 s | |
| 16 | Desligar/ligar a TV | anotar o que acontece (o navegador reabre sozinho? volta à última página?) | |
| 17 | 24 h ligada | memória estável (o player recarrega sozinho de madrugada) | |
| 18 | Vertical (se aplicável) | tela cadastrada como vertical exibe conteúdo 9:16 corretamente | |

## Limitações conhecidas (documentadas, não prometidas)
- **Início automático ao ligar a TV** depende do modelo; a maioria dos navegadores de TV não abre sozinha. Alternativa confiável: aparelho Android TV/Google TV com navegador em modo quiosque.
- **Cache offline** exige Service Worker + Cache API + HTTPS. Navegadores mais antigos de TV podem não ter: a TV toca da rede e para se a internet cair e a página for recarregada.
- O navegador pode apagar o cache por falta de espaço; o player baixa de novo quando a internet voltar.
- **Autoplay com som** costuma ser bloqueado: o player toca **mudo** sempre.
- **H.265/HEVC, 4K e VP9** podem não tocar: o painel marca esses arquivos com "Atenção". Prefira MP4 H.264, 1920×1080, até ~100 MB por vídeo.
- Algumas TVs têm um único decodificador de vídeo: entre dois vídeos seguidos pode haver uma piscada curta.
- A pré-visualização do painel é **simulação**, não a imagem real da TV.

## Quando o navegador da TV não serve
Se o teste 3 mostrar "Vídeo MP4/H.264: não" ou os testes 6–8 falharem: use um **player externo** ligado na HDMI (Android TV box, Chromecast com Google TV, Fire TV) abrindo o mesmo endereço `/tv` num navegador atualizado. O pareamento é igual.

## Registro
| Data | Unidade/ambiente | Modelo | Sistema/navegador | Testes ok | Observações |
|---|---|---|---|---|---|
| | | | | | |
