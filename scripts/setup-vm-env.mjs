#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const sources = [
  resolve(root, ".env"),
  resolve(root, "../FlowDesk/.env"),
].filter(existsSync);

if (sources.length === 0) {
  console.error("\n❌ Crie .env nesta pasta (cp .env.example .env) ou tenha ~/FlowDesk/.env\n");
  process.exit(1);
}

const env = sources.reduce((acc, p) => ({ ...loadEnv(p), ...acc }), loadEnv(sources[0]));
const pick = (key, fallback = "") => env[key]?.trim() || fallback;

const waHost = (
  pick("WA_API_PUBLIC_URL") ||
  pick("WA_API_DOMAIN") ||
  pick("API_DOMAIN", "zapflow.duckdns.org")
)
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const hostingOrigins = [
  "https://zapflow-higor-2026.web.app",
  "https://zapflow-higor-2026.firebaseapp.com",
  "https://flowdesk.ia.br",
];
const corsFromEnv = pick("CORS_ORIGIN")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const corsOrigin = [...new Set([...hostingOrigins, ...corsFromEnv.filter((o) => !o.includes("localhost"))])].join(
  ",",
);

const webOrigin = pick("WEB_ORIGIN", "https://flowdesk.ia.br");

const lines = [
  "# Gerado por pnpm setup:vm-env — flowdesk-wa",
  `# Webhook Stripe: https://${waHost}/webhooks/stripe`,
  "",
  "API_PORT=3001",
  `WA_API_PUBLIC_URL=https://${waHost}`,
  `WEB_ORIGIN=${webOrigin}`,
  `CORS_ORIGIN=${corsOrigin}`,
  "",
  `FIREBASE_PROJECT_ID=${pick("FIREBASE_PROJECT_ID", "zapflow-higor-2026")}`,
  `FIREBASE_CLIENT_EMAIL=${pick("FIREBASE_CLIENT_EMAIL", "firebase-adminsdk-fbsvc@zapflow-higor-2026.iam.gserviceaccount.com")}`,
  "GOOGLE_APPLICATION_CREDENTIALS=/app/.secrets/firebase-adminsdk.json",
  "",
  "REDIS_URL=redis://redis:6379",
  "WA_SESSION_PATH=/app/sessions",
  "WA_STATUS_MEDIA_PATH=/app/status-media",
  "",
  `STRIPE_SECRET_KEY=${pick("STRIPE_SECRET_KEY")}`,
  `STRIPE_WEBHOOK_SECRET=${pick("STRIPE_WEBHOOK_SECRET")}`,
  `STRIPE_PRICE_STARTER=${pick("STRIPE_PRICE_STARTER")}`,
  `STRIPE_PRICE_PRO=${pick("STRIPE_PRICE_PRO")}`,
  `STRIPE_PRICE_UNLIMITED=${pick("STRIPE_PRICE_UNLIMITED")}`,
  "",
  `ASAAS_API_KEY=${pick("ASAAS_API_KEY")}`,
  `ASAAS_BASE_URL=${pick("ASAAS_BASE_URL", "https://api.asaas.com/api/v3")}`,
  `ASAAS_WEBHOOK_TOKEN=${pick("ASAAS_WEBHOOK_TOKEN")}`,
  "",
];

const vmPath = resolve(root, ".env.vm");
writeFileSync(vmPath, `${lines.join("\n")}\n`);

console.log(`\n✅ ${vmPath}`);
console.log(`   Fonte: ${sources[sources.length - 1]}`);
console.log(`   API: https://${waHost}`);
if (!pick("STRIPE_SECRET_KEY")) {
  console.warn("\n⚠️  STRIPE_SECRET_KEY vazio — preencha .env antes do deploy");
}
if (!pick("STRIPE_WEBHOOK_SECRET")) {
  console.warn("⚠️  STRIPE_WEBHOOK_SECRET vazio — crie webhook no Stripe depois");
}
