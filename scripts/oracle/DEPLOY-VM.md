# Deploy flowdesk-wa na VM Oracle — API Hono completa

Repositório: https://github.com/higorhbs/flowdesk-wa  
Imagem Docker: `ghcr.io/higorhbs/flowdesk-backend:latest`  
VM: `ubuntu@163.176.132.231` · pasta `~/flowdesk-wa`

A VM expõe a **API completa do FlowDesk** (Hono): `/auth/google`, `/register`, `/businesses`, `/chat/whatsapp`, `/stories/whatsapp`, WhatsApp workers (`ENABLE_WORKERS=true`).

---

## 1. No Mac — push flowdesk-wa + FlowDesk

```bash
cd ~/flowdesk-wa
git add -A && git commit -m "deploy: api hono na vm" && git push origin main
```

Aguarde: https://github.com/higorhbs/flowdesk-wa/actions → **Build FlowDesk API Docker image** verde.

> O workflow clona `higorhbs/FlowDesk` e builda `Dockerfile.backend`.

---

## 2. No Mac — env para VM

```bash
cd ~/flowdesk-wa
pnpm setup:vm-env
pnpm send:vm-env
```

Usa `~/FlowDesk/apps/backend/.env` como fonte (FIREBASE_WEB_API_KEY, Stripe, etc.).

---

## 3. Na VM — pull e subir

```bash
ssh -i ~/Documents/ssh-key-2026-05-28.key ubuntu@163.176.132.231
cd ~/flowdesk-wa
git pull origin main
cp Caddyfile.example Caddyfile   # primeira vez
echo "PAT_read_packages" | docker login ghcr.io -u higorhbs --password-stdin
export API_IMAGE=ghcr.io/higorhbs/flowdesk-backend:latest
docker compose -f docker-compose.https.pull.yml pull
docker compose -f docker-compose.https.pull.yml up -d
```

---

## 4. Validar

```bash
curl -sS https://zapflow.duckdns.org/health
curl -sS -X POST https://zapflow.duckdns.org/auth/google \
  -H 'Content-Type: application/json' -d '{"accessToken":"test"}'
```

Esperado no segundo: **400** ou **401** (token inválido) — **não** 404.

---

## 5. Build local (Mac, com FlowDesk ao lado)

```bash
cd ~/flowdesk-wa
docker compose -f docker-compose.https.yml build api
docker compose -f docker-compose.https.yml up -d
```

Requer `~/FlowDesk` cloneado ao lado de `~/flowdesk-wa`.

---

## 6. Logs

```bash
docker compose -f docker-compose.https.pull.yml logs -f api --tail 100
```

---

## Front (Firebase Hosting)

```bash
cd ~/FlowDesk
pnpm setup:billing-env
pnpm deploy:hosting
```

`.env.production` deve ter:
```
NEXT_PUBLIC_API_URL=https://zapflow.duckdns.org
NEXT_PUBLIC_WA_API_URL=https://zapflow.duckdns.org
```
