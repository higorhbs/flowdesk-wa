import fs from "fs";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { hasAdminCredential } from "@flowdesk/firebase";
import { statusMediaRoot } from "./status-media.js";

export async function buildApp(): Promise<FastifyInstance> {
  const logLevel = process.env.LOG_LEVEL?.trim();
  const app = Fastify({
    logger: logLevel ? { level: logLevel } : true,
  });

  const corsOrigin = process.env.CORS_ORIGIN;
  fs.mkdirSync(statusMediaRoot(), { recursive: true });
  await app.register(multipart, { limits: { fileSize: 16 * 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, {
    root: statusMediaRoot(),
    prefix: "/status-media/",
    decorateReply: false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (corsOrigin === "*" || corsOrigin === origin) return cb(null, true);
      if (
        !corsOrigin &&
        (/^https?:\/\/localhost(:\d+)?$/.test(origin) ||
          /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
          /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(origin) ||
          /^https:\/\/[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/.test(origin))
      ) {
        return cb(null, true);
      }
      if (corsOrigin?.split(",").map((o) => o.trim()).includes(origin)) return cb(null, true);
      cb(new Error("CORS"), false);
    },
    credentials: true,
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
