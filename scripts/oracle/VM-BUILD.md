# Build Docker na VM Oracle (trava no `tsc`)

## Por que trava

VM free tier (~1 GB RAM). O passo `pnpm … build` roda **4× TypeScript** seguidos. Sem RAM sobra, o Linux usa **swap** no disco e parece congelado (10–20+ min no mesmo passo).

Não é bug do código — é **falta de memória no build**.

## Melhor opção: não buildar na VM

1. Push no GitHub → workflow **Build WA API Docker image** gera a imagem no GHCR.
2. Na VM, use `docker-compose.https.pull.yml` (só pull, sem build).

```bash
docker login ghcr.io -u SEU_USER
docker compose -f docker-compose.https.pull.yml pull
docker compose -f docker-compose.https.pull.yml up -d
```

## Se precisar buildar na VM

### 1. Swap (2 GB)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

### 2. Build com menos RAM por etapa

```bash
docker compose -f docker-compose.https.yml build --build-arg NODE_OPTIONS=--max-old-space-size=256 wa-api
```

### 3. Build no Mac e enviar (ARM vs x86)

Oracle x86:

```bash
docker buildx build --platform linux/amd64 -t flowdesk-wa:local .
docker save flowdesk-wa:local | gzip > wa-api.tar.gz
scp wa-api.tar.gz opc@VM:~/
# na VM:
docker load < wa-api.tar.gz
```

## COMPOSE_BAKE

Aviso do Docker Compose sobre bake — opcional: `export COMPOSE_BAKE=true`. Não causa o travamento.
