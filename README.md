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

DuckDNS (`zapflow.duckdns.org`) aponta para o IP público da VM. Libere a porta **3001** no firewall Oracle antes do `docker compose up`.

O dashboard usa Firestore direto; só WhatsApp aponta para este serviço.
