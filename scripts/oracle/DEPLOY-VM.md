# Deploy flowdesk-wa na VM Oracle — comandos prontos

Repositório: https://github.com/higorhbs/flowdesk-wa  
Imagem Docker: `ghcr.io/higorhbs/flowdesk-wa:latest`  
VM: `ubuntu@163.176.132.231` · pasta `~/flowdesk-wa`

---

## 1. No Mac — enviar código e gerar imagem no GitHub

```bash
cd ~/flowdesk-wa
git add -A
git commit -m "deploy: ajustes vm"
git push origin main
```

Abra: https://github.com/higorhbs/flowdesk-wa/actions  
Aguarde o workflow **Build WA API Docker image** ficar verde.

> Primeira vez: em https://github.com/users/higorhbs/packages → pacote `flowdesk-wa` → **Package settings** → mude para **Public** (ou use PAT com `read:packages` no passo 3).

---

## 2. No Mac — gerar `.env` e copiar para a VM

```bash
cd ~/flowdesk-wa
cp .env.example .env
pnpm send:vm-env
```

Credencial: coloque em `flowdesk-wa/.secrets/firebase-adminsdk.json` ou use a de `~/FlowDesk/.secrets/` (o script acha sozinho).

---

## 3. Na VM — login GHCR, pull e subir (sem build local)

```bash
ssh -i ~/Documents/ssh-key-2026-05-28.key ubuntu@163.176.132.231
```

Primeira vez na VM (clone):

```bash
cd ~
git clone https://github.com/higorhbs/flowdesk-wa.git
cd ~/flowdesk-wa
cp .env.example .env
mkdir -p .secrets
```

Atualizar código:

```bash
cd ~/flowdesk-wa
git pull origin main
```

```bash
echo "COLE_SEU_GITHUB_PAT_COM_read:packages" | docker login ghcr.io -u higorhbs --password-stdin
```

```bash
export WA_API_IMAGE=ghcr.io/higorhbs/flowdesk-wa:latest
docker compose -f docker-compose.https.pull.yml pull
docker compose -f docker-compose.https.pull.yml up -d
```

```bash
docker compose -f docker-compose.https.pull.yml ps
curl -sS https://zapflow.duckdns.org/health
curl -sS https://zapflow.duckdns.org/health/billing
```

---

## 4. Se ainda quiser build na VM (lento — precisa swap)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
free -h
```

```bash
cd ~/flowdesk-wa
docker compose -f docker-compose.https.yml build --build-arg NODE_OPTIONS=--max-old-space-size=256 wa-api
docker compose -f docker-compose.https.yml up -d
```

---

## 5. Atualizar depois de novo push no GitHub

```bash
cd ~/flowdesk-wa
git pull origin main
export WA_API_IMAGE=ghcr.io/higorhbs/flowdesk-wa:latest
docker compose -f docker-compose.https.pull.yml pull
docker compose -f docker-compose.https.pull.yml up -d
```

---

## 6. Logs e reinício

```bash
cd ~/flowdesk-wa
docker compose -f docker-compose.https.pull.yml logs -f wa-api --tail 100
```

```bash
cd ~/flowdesk-wa
docker compose -f docker-compose.https.pull.yml restart wa-api
```
