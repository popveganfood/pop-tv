# Implantação: Supabase + Cloudflare R2 + Railway

Nenhum segredo vai para o repositório. Todos os valores abaixo são configurados nos painéis de cada serviço (no Railway, em **Variables**). Nada aqui foi criado automaticamente: cada passo que pode gerar cobrança está sinalizado com 💲.

## 1. Banco — Supabase (plano Free)

1. supabase.com → **New project** (região South America – São Paulo). Guarde a senha do banco num gerenciador de senhas.
2. **Connect → Connection string → Session pooler** (porta 5432, funciona em IPv4). Copie a URL e troque `[YOUR-PASSWORD]`.
3. Esse valor vai em `DATABASE_URL` no Railway, junto com `DATABASE_SSL=true`.
4. As tabelas são criadas sozinhas na primeira subida (migrações em `server/migrations`). O app acessa o banco só pelo servidor; não é preciso habilitar a API REST nem RLS para o POP TV.

Limites do Free (out/2026): 500 MB de banco, 5 GB de egress/mês, pausa após 7 dias sem atividade — as TVs mantêm o projeto ativo. Veja `docs/custos.md`.

> Alternativa: Postgres do próprio Railway (💲 entra no consumo do Railway). Basta trocar `DATABASE_URL`.

## 2. Arquivos — Cloudflare R2

1. Cloudflare → **R2** → **Create bucket** `pop-tv-media` (localização automática). 💲 grátis até 10 GB/mês; depois US$ 0,015/GB.
2. **Não** habilite acesso público nem domínio `r2.dev`: o POP TV usa só URLs assinadas.
3. **R2 → Manage API tokens → Create API token**: permissão *Object Read & Write*, restrita ao bucket `pop-tv-media`. Anote *Access Key ID*, *Secret Access Key* e o *Account ID*.
4. No bucket → **Settings → CORS policy** (troque pelo seu domínio):

```json
[
  {
    "AllowedOrigins": ["https://tv.popveganfood.com.br"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

O CORS permite o envio pelo painel e o cache offline do player. Sem ele, os uploads falham e as TVs tocam direto da rede (sem cache).

## 3. Aplicação — Railway

1. Suba o código num repositório GitHub (privado).
2. Railway → projeto existente do POP → **New → GitHub Repo** → escolha o repositório. O `railway.json` já define build (`npm ci && npm run build`), início (`npm start`), health check (`/api/health`) e 1 réplica.
3. **Variables**:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | URL do Session pooler do Supabase |
| `DATABASE_SSL` | `true` |
| `PUBLIC_URL` | `https://tv.popveganfood.com.br` (ou o domínio do Railway) |
| `APP_SECRET` | 64 caracteres aleatórios (`openssl rand -hex 32`) |
| `STORAGE_DRIVER` | `r2` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | do passo 2 |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | administrador inicial (só é usado se não houver usuários; depois pode apagar a senha da variável) |
| `MAX_VIDEO_MB` / `MAX_IMAGE_MB` | opcionais (padrão 500 / 25) |
| `POLL_SECONDS` | opcional (padrão 30) |

4. **Settings → Networking → Generate Domain**, ou domínio próprio `tv.popveganfood.com.br` (CNAME no DNS do site). HTTPS é obrigatório para o cache offline das TVs.
5. Mantenha **1 réplica** (o snapshot em memória e o rate limit assumem uma instância).

O servidor recusa subir com configuração insegura: `STORAGE_DRIVER=local` em produção, `APP_SECRET` curto ou credenciais R2 ausentes.

## 4. Primeiro acesso

1. Abra `PUBLIC_URL`, entre com o admin inicial.
2. **Usuários → Configurações gerais**: confira a playlist de segurança e a tolerância offline.
3. **Unidades**: edite a Consolação (endereço, contato, imagem).
4. Envie conteúdo institucional para a playlist **Segurança POP** e publique.
5. Pareie as TVs (`docs/manual-parear-tvs.md`).

## Desenvolvimento × produção

| | Desenvolvimento | Produção |
|---|---|---|
| `NODE_ENV` | `development` | `production` (ou ausente — o servidor trata como produção) |
| Arquivos | disco local (`./data/uploads`) | R2 |
| Cookies | sem `Secure` | `Secure`, `HttpOnly`, `SameSite=Lax` |
| `APP_SECRET` | pode ser o padrão | obrigatório, 32+ caracteres |

## Processo de publicação (deploy)

1. Abra uma branch, rode `npm run typecheck && npm test && npm run e2e && npm run e2e:panel`.
2. Merge na `main` → o Railway faz o deploy automático. As migrações rodam ao iniciar (em transação; se falhar, o deploy não sobe e a versão anterior continua no ar).
3. Depois do deploy: abra o painel, confira o dashboard e uma TV de teste.
4. Rollback: **Deployments → Redeploy** da versão anterior no Railway. Migrações são aditivas; não apague colunas no mesmo deploy em que o código deixa de usá-las.
