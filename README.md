# FlowDesk VM — API + WhatsApp

Deploy na VM Oracle (`zapflow.duckdns.org`) com **API Hono completa** do monorepo [FlowDesk](https://github.com/higorhbs/FlowDesk): auth, negócios, chat, stories, billing, WhatsApp workers.

O serviço antigo `wa-api` (Fastify parcial) foi substituído pelo backend `@flowdesk/backend`.

## Rotas principais

| Área | Exemplos |
|------|----------|
| Auth | `POST /auth/google`, `/register`, `/login` |
| Negócio | `GET/POST /businesses`, `/business`, `/schedules` |
| WhatsApp | `/chat/whatsapp/qr-code/:id`, mensagens, mídia |
| Stories | `/stories/whatsapp/:businessId` |
| Billing | `/billing/checkout`, `/webhooks/stripe` |
| Health | `GET /health`, `/health/admin` |

## Setup local (API na VM simulada)

```bash
cp .env.example .env
pnpm setup:vm-env
# credencial em .secrets/firebase-adminsdk.json
docker compose -f docker-compose.https.yml up -d --build
```

Requer `../FlowDesk` cloneado ao lado desta pasta.

## Deploy produção (imagem GHCR)

```bash
pnpm setup:vm-env
pnpm send:vm-env
```

Na VM: ver `scripts/oracle/DEPLOY-VM.md`

Imagem: `ghcr.io/higorhbs/flowdesk-api:latest`

## Front FlowDesk

```
NEXT_PUBLIC_API_URL=https://zapflow.duckdns.org
NEXT_PUBLIC_WA_API_URL=https://zapflow.duckdns.org
```

No Mac: `cd ~/FlowDesk && pnpm setup:billing-env && pnpm deploy:hosting`

## Caddy

```bash
cp Caddyfile.example Caddyfile
```

Proxy: `zapflow.duckdns.org` → `api:3001`

## Legado

`apps/wa-api` (Fastify) e `Dockerfile` antigo permanecem no repo só como referência; produção usa `Dockerfile.backend` + serviço `api`.
