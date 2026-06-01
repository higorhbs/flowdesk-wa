# FlowDesk WA — Agente WhatsApp (Raspberry Pi)

API mínima para conectar WhatsApp, processar mensagens do bot e gravar no Firestore.

## Rotas expostas

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check |
| GET | `/health/whatsapp` | Status das sessões |
| POST | `/businesses/:id/whatsapp/connect` | Gerar QR Code |
| GET | `/businesses/:id/whatsapp/status` | Status da conexão |
| POST | `/businesses/:id/whatsapp/disconnect` | Desconectar |
| POST | `/businesses/:id/whatsapp/send` | Enviar mensagem manual |

Todas as rotas WhatsApp exigem `Authorization: Bearer <Firebase ID Token>`.

## Setup

```bash
pnpm install
cp .env.example .env
# Coloque firebase-adminsdk.json em .secrets/

pnpm dev
```

## Docker (Raspberry Pi)

```bash
cp .env.example .env
docker compose up -d --build
```

## Front FlowDesk

Configure no `.env.production` do web:

```
NEXT_PUBLIC_WA_API_URL=http://zapflow.duckdns.org:3001
```

DuckDNS (`zapflow.duckdns.org`) aponta para o IP público da VM Oracle (`163.176.132.231`). Na VM o clone fica em `~/flowdesk-wa`.

```bash
# No Mac (chave em Documents)
ssh -i ~/Documents/ssh-key-2026-05-28.key ubuntu@163.176.132.231
cd ~/flowdesk-wa
```

Produção com HTTPS: `docker compose -f docker-compose.https.yml up -d --build`

Inclua `https://flowdesk.ia.br` em `CORS_ORIGIN` se o painel estiver nesse domínio.

**Checkout Stripe (planos)** não roda neste repo — use a API do monorepo **FlowDesk** (`~/FlowDesk` + `scripts/oracle/deploy-api.sh`) ou `NEXT_PUBLIC_API_URL=https://SEU-PROJETO.web.app/api` (Firebase Functions).

O dashboard usa Firestore direto; só WhatsApp aponta para este serviço.
