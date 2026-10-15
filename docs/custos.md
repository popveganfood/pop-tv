# Estimativa de custos

Preços conferidos em 14/10/2026 nas páginas oficiais: [Railway](https://www.railway.com/pricing), [Supabase](https://supabase.com/pricing), [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/). Eles mudam: reconfira antes de contratar. **O sistema não é "grátis para sempre"**: ele cabe nos planos gratuitos/atuais nos volumes abaixo, mas o crescimento da biblioteca e do número de TVs pode gerar cobrança.

## Preços usados

| Serviço | Grátis | Depois |
|---|---|---|
| Railway (Hobby, que o POP já usa) | US$ 5/mês de crédito incluído no plano | vCPU ≈ US$ 20/mês por vCPU contínua · RAM ≈ US$ 10/GB-mês · saída US$ 0,05/GB |
| Supabase Free | 500 MB de banco · 5 GB egress/mês · 2 projetos | Pro US$ 25/mês |
| Cloudflare R2 | 10 GB-mês · 1 M ops Classe A · 10 M ops Classe B · saída grátis | US$ 0,015/GB-mês · A US$ 4,50/M · B US$ 0,36/M |

## Premissas

- Cada TV sincroniza a cada 30 s: 86.400 sincronizações/mês por TV, ~0,5 KB de resposta quando nada muda.
- Cada TV baixa ~50 arquivos novos por mês (uma vez cada; o resto vem do cache).
- Biblioteca de 5 GB (depende do conteúdo, não do número de TVs).
- Servidor Node ocioso: ~0,02 vCPU e ~150 MB de RAM.

## Estimativa mensal

| | 5 TVs | 10 TVs | 25 TVs | 50 TVs |
|---|---|---|---|---|
| **Hospedagem** Railway (CPU + RAM) | ~US$ 2,00 | ~US$ 2,00 | ~US$ 2,20 | ~US$ 2,50 |
| **Transferência** Railway (sync) | 0,2 GB → US$ 0,01 | 0,4 GB → US$ 0,02 | 1,1 GB → US$ 0,05 | 2,2 GB → US$ 0,11 |
| **Requisições** ao servidor | 0,43 M | 0,86 M | 2,2 M | 4,3 M (incluídas na CPU) |
| **Banco** Supabase egress (estimado ~0,6 KB/sync) | 0,26 GB | 0,5 GB | 1,3 GB | 2,6 GB (dentro dos 5 GB) |
| **Armazenamento** R2 (5 GB) | US$ 0 | US$ 0 | US$ 0 | US$ 0 |
| **Requisições** R2 Classe B (downloads) | 250 | 500 | 1.250 | 2.500 (grátis até 10 M) |
| **Transferência** R2 | grátis | grátis | grátis | grátis |
| **Total adicional estimado** | **≈ US$ 0** (cabe no crédito do Hobby) | **≈ US$ 0** | **≈ US$ 0** | **≈ US$ 0–3** |

"≈ US$ 0" significa que o consumo cabe no crédito de US$ 5 do Railway **se** os outros serviços do POP no mesmo plano não esgotarem esse crédito.

## Quando passa a custar

- Biblioteca acima de 10 GB no R2: +US$ 0,015 por GB/mês (ex.: 50 GB ≈ US$ 0,60/mês).
- Egress do Supabase perto de 5 GB (≈ 90+ TVs com sync de 30 s): aumente `POLL_SECONDS` para 60 (corta pela metade) ou mude para o Postgres do Railway (~US$ 1–3/mês de consumo).
- Banco acima de 500 MB: improvável (o banco guarda só metadados; os arquivos ficam no R2).
- Nenhum serviço cobra por TV.
