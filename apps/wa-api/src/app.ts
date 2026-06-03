import fs from "fs";
import path from "path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyRawBody from "fastify-raw-body";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { billingRoutes } from "./routes/billing.js";
import { privacyRoutes } from "./routes/privacy.js";
import { webhookRoutes } from "./routes/webhooks.js";
import Stripe from "stripe";
import { hasAdminCredential } from "@flowdesk/firebase";
import { PLAN_PRICES, planPriceBrlCents } from "@flowdesk/shared";
import { statusMediaRoot } from "./status-media.js";
import { chatMediaRoot } from "./chat-media.js";
import { isCorsOriginAllowed } from "./cors.js";

export async function buildApp(): Promise<FastifyInstance> {
  const logLevel = process.env.LOG_LEVEL?.trim();
  const app = Fastify({
    logger: logLevel ? { level: logLevel } : true,
  });

  await app.register(formbody);
  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
    routes: ["/webhooks/stripe"],
  });

  const corsOrigin = process.env.CORS_ORIGIN;
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (isCorsOriginAllowed(origin, corsOrigin)) return cb(null, origin);
      app.log.warn({ origin, corsOrigin }, "CORS origin blocked");
      cb(new Error("CORS origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });

  fs.mkdirSync(statusMediaRoot(), { recursive: true });
  fs.mkdirSync(chatMediaRoot(), { recursive: true });
  await app.register(multipart, { limits: { fileSize: 16 * 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, {
    root: statusMediaRoot(),
    prefix: "/status-media/",
    decorateReply: false,
  });
  const chatMediaMime: Record<string, string> = {
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  await app.register(fastifyStatic, {
    root: chatMediaRoot(),
    prefix: "/chat-media/",
    decorateReply: false,
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const mime = chatMediaMime[ext];
      if (mime) res.setHeader("Content-Type", mime);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Access-Control-Allow-Origin", "*");
    },
  });

  app.get("/health", () => ({
    ok: true,
    ts: new Date().toISOString(),
    publicUrl: process.env.WA_API_PUBLIC_URL?.trim() || null,
  }));
  app.get("/health/whatsapp", async () => {
    const { waManager } = await import("./wa-manager.js");
    const sessionsRoot = process.env.WA_SESSION_PATH?.trim() ?? "";
    const { listStoredSessionBusinessIds } = await import("./wa-lifecycle.js");
    const stored = sessionsRoot ? listStoredSessionBusinessIds(sessionsRoot) : [];
    const live = [...waManager.all().entries()].map(([id, client]) => client.getDebugInfo());
    return { enabled: true, stored, live };
  });
  app.get("/health/admin", () => ({
    ok: hasAdminCredential(),
    adminConfigured: hasAdminCredential(),
    projectId: process.env.FIREBASE_PROJECT_ID ?? null,
  }));
  app.get("/health/billing", () => ({
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
  }));
  app.get("/health/billing/prices", async (_req, reply) => {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key) return reply.status(503).send({ ok: false, error: "STRIPE_SECRET_KEY ausente" });
    const stripe = new Stripe(key);
    const plans = ["STARTER", "PRO", "UNLIMITED"] as const;
    const prices: Record<string, { priceId: string | null; brl: number; stripeBrl: number | null; ok: boolean }> = {};
    for (const plan of plans) {
      const priceId = process.env[`STRIPE_PRICE_${plan}`]?.trim() ?? null;
      const brl = PLAN_PRICES[plan].brl;
      if (!priceId) {
        prices[plan] = { priceId: null, brl, stripeBrl: null, ok: false };
        continue;
      }
      try {
        const p = await stripe.prices.retrieve(priceId);
        const stripeBrl = (p.unit_amount ?? 0) / 100;
        prices[plan] = {
          priceId,
          brl,
          stripeBrl,
          ok: p.unit_amount === planPriceBrlCents(plan),
        };
      } catch {
        prices[plan] = { priceId, brl, stripeBrl: null, ok: false };
      }
    }
    const ok = Object.values(prices).every((p) => p.ok);
    return reply.status(ok ? 200 : 503).send({ ok, prices });
  });

  await app.register(billingRoutes);
  await app.register(privacyRoutes);
  await app.register(webhookRoutes);
  await app.register(whatsappRoutes);

  const { waManager } = await import("./wa-manager.js");
  const sessionsRoot = process.env.WA_SESSION_PATH?.trim();
  if (sessionsRoot) {
    const { restoreWhatsAppSessions } = await import("./wa-lifecycle.js");
    void restoreWhatsAppSessions(waManager, sessionsRoot);
  }
  const { startReminderWorker, startMessageWorker } = await import("./workers/message-worker.js");
  startMessageWorker(waManager);
  startReminderWorker(waManager);

  const { startStatusScheduler } = await import("./workers/status-scheduler.js");
  startStatusScheduler(waManager);

  return app;
}
