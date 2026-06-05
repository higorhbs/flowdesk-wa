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

const flowdeskEnv = resolve(root, "../FlowDesk/.env");
const flowdeskBackendEnv = resolve(root, "../FlowDesk/apps/backend/.env");
const localEnv = resolve(root, ".env");

const sources = [flowdeskBackendEnv, flowdeskEnv, localEnv].filter(existsSync);

if (sources.length === 0) {
  console.error("\n❌ Crie .env aqui ou tenha ~/FlowDesk/apps/backend/.env\n");
  process.exit(1);
}

const env = sources.reduce((acc, p) => ({ ...loadEnv(p), ...acc }), loadEnv(sources[0]));
const pick = (key, fallback = "") => env[key]?.trim() || fallback;

const waHost = (
  pick("WA_API_PUBLIC_URL") ||
  pick("API_PUBLIC_URL") ||
  pick("API_DOMAIN", "zapflow.duckdns.org")
)
  .replace(/^https?:\/\//, "")
  .replace(/\/$/, "");

const publicApi = `https://${waHost}`;

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
  "# Gerado por pnpm setup:vm-env — flowdesk-wa (API Hono FlowDesk)",
  `# Webhook Stripe: ${publicApi}/webhooks/stripe`,
  `# Login Google: POST ${publicApi}/auth/google`,
  "",
  "PORT=3001",
  "ENABLE_WORKERS=true",
  `API_PUBLIC_URL=${publicApi}`,
  `WA_API_PUBLIC_URL=${publicApi}`,
  `WEB_ORIGIN=${webOrigin}`,
  `CORS_ORIGIN=${corsOrigin}`,
  "",
  `FIREBASE_WEB_API_KEY=${pick("FIREBASE_WEB_API_KEY", pick("NEXT_PUBLIC_FIREBASE_API_KEY"))}`,
  `FIREBASE_PROJECT_ID=${pick("FIREBASE_PROJECT_ID", "zapflow-higor-2026")}`,
  `FIREBASE_CLIENT_EMAIL=${pick("FIREBASE_CLIENT_EMAIL", "firebase-adminsdk-fbsvc@zapflow-higor-2026.iam.gserviceaccount.com")}`,
  `FIREBASE_STORAGE_BUCKET=${pick("FIREBASE_STORAGE_BUCKET", pick("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "zapflow-higor-2026.firebasestorage.app"))}`,
  "GOOGLE_APPLICATION_CREDENTIALS=/app/.secrets/firebase-adminsdk.json",
  "",
  `INTERNAL_NOTIFY_SECRET=${pick("INTERNAL_NOTIFY_SECRET", "change-me-internal-secret")}`,
  `LOG_LEVEL=${pick("LOG_LEVEL", "info")}`,
  `PRIVACY_RETENTION_INTERVAL_HOURS=${pick("PRIVACY_RETENTION_INTERVAL_HOURS", "24")}`,
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
  `ASAAS_DEFAULT_CPF_CNPJ=${pick("ASAAS_DEFAULT_CPF_CNPJ")}`,
  "",
];

const vmPath = resolve(root, ".env.vm");
writeFileSync(vmPath, `${lines.join("\n")}\n`);

console.log(`\n✅ ${vmPath}`);
console.log(`   Fonte: ${sources[sources.length - 1]}`);
console.log(`   API: ${publicApi}`);
if (!pick("FIREBASE_WEB_API_KEY", pick("NEXT_PUBLIC_FIREBASE_API_KEY"))) {
  console.warn("\n⚠️  FIREBASE_WEB_API_KEY vazio — login Google/e-mail falha");
}
if (!pick("STRIPE_SECRET_KEY")) {
  console.warn("⚠️  STRIPE_SECRET_KEY vazio — preencha .env antes do deploy");
}
console.log("\nPróximo: pnpm send:vm-env → na VM: docker compose -f docker-compose.https.pull.yml up -d\n");
