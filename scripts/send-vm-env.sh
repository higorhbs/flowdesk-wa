#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VM_HOST="${VM_HOST:-ubuntu@163.176.132.231}"
SSH_KEY="${SSH_KEY:-$HOME/Documents/ssh-key-2026-05-28.key}"
VM_DIR="${VM_DIR:-~/flowdesk-wa}"

node "$ROOT/scripts/setup-vm-env.mjs"

ENV_VM="$ROOT/.env.vm"
if [[ ! -f "$ENV_VM" ]]; then
  echo "❌ .env.vm não encontrado"
  exit 1
fi

SECRET="$ROOT/.secrets/firebase-adminsdk.json"
if [[ ! -f "$SECRET" && -f "$ROOT/../FlowDesk/.secrets/firebase-adminsdk.json" ]]; then
  SECRET="$ROOT/../FlowDesk/.secrets/firebase-adminsdk.json"
fi
if [[ ! -f "$SECRET" ]]; then
  echo "❌ firebase-adminsdk.json não encontrado em .secrets/ nem ../FlowDesk/.secrets/"
  exit 1
fi

scp -i "$SSH_KEY" "$ENV_VM" "${VM_HOST}:${VM_DIR}/.env"
scp -i "$SSH_KEY" "$SECRET" "${VM_HOST}:${VM_DIR}/.secrets/firebase-adminsdk.json"

echo ""
echo "✅ .env e credencial enviados para ${VM_HOST}:${VM_DIR}"
echo ""
echo "Na VM:"
echo "  cd ~/flowdesk-wa && git pull origin main"
echo "  cp Caddyfile.example Caddyfile   # se ainda não tiver Caddyfile"
echo "  echo \"PAT_read_packages\" | docker login ghcr.io -u higorhbs --password-stdin"
echo "  export API_IMAGE=ghcr.io/higorhbs/flowdesk-backend:latest"
echo "  docker compose -f docker-compose.https.pull.yml pull"
echo "  docker compose -f docker-compose.https.pull.yml up -d"
echo "  curl -sS -X POST https://zapflow.duckdns.org/auth/google -H 'Content-Type: application/json' -d '{}'"
