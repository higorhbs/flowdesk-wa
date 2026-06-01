import fs from "fs";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyRawBody from "fastify-raw-body";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { billingRoutes } from "./routes/billing.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { hasAdminCredential } from "@flowdesk/firebase";
import { statusMediaRoot } from "./status-media.js";
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
  await app.register(multipart, { limits: { fileSize: 16 * 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, {
    root: statusMediaRoot(),
    prefix: "/status-media/",
    decorateReply: false,
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

  await app.register(billingRoutes);
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
