import { FastifyInstance, FastifyReply } from "fastify";
import fs from "fs";
import path from "path";
import {
  getBusiness,
  setBusinessConnected,
  getConversation,
  upsertConversation,
  createMessage,
} from "@flowdesk/firebase";
import { requireAuth } from "../middleware/auth";
import type { WhatsAppClient } from "@flowdesk/whatsapp-client";
import { isWhatsAppRuntime, waManager } from "../wa-manager.js";
import {
  ensureWhatsAppClient,
  hasStoredSession,
  resolveWhatsAppClient,
  teardownWhatsAppSession,
} from "../wa-lifecycle.js";
import { saveStatusMedia } from "../status-media.js";
import { saveChatMedia } from "../chat-media.js";

type ConnectResult = {
  status: string;
  qr?: string;
  message?: string;
};

function waUnavailable(reply: FastifyReply) {
  return reply.status(503).send({
    status: "error",
    message:
      "WhatsApp exige API com processo contínuo (servidor com ENABLE_WORKERS=true).",
  });
}

function waitForQr(client: WhatsAppClient, timeoutMs = 35_000): Promise<ConnectResult> {
  if (client.isConnected()) {
    return Promise.resolve({ status: "already_connected" });
  }
  if (client.lastQrDataUrl) {
    return Promise.resolve({ status: "qr", qr: client.lastQrDataUrl });
  }

  return new Promise((resolve) => {
    const done = (result: ConnectResult) => {
      clearTimeout(timer);
      client.off("qr", onQr);
      client.off("connected", onConnected);
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (client.lastQrDataUrl) {
        done({ status: "qr", qr: client.lastQrDataUrl });
        return;
      }
      done({
        status: "connecting",
        message: "Gerando QR Code. Aguarde alguns segundos nesta tela.",
      });
    }, timeoutMs);

    const onQr = (qrDataUrl: string) => done({ status: "qr", qr: qrDataUrl });
    const onConnected = () => done({ status: "already_connected" });

    client.once("qr", onQr);
    client.once("connected", onConnected);
  });
}

async function resetWhatsAppSession(businessId: string, sessionsRoot: string) {
  const existing = waManager.get(businessId);
  if (existing) {
    try {
      await existing.logout();
    } catch {
      const sessionDir = path.join(sessionsRoot, businessId);
      if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    waManager.remove(businessId);
    return;
  }
  const sessionDir = path.join(sessionsRoot, businessId);
  if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
}

async function connectForQr(
  businessId: string,
  sessionsRoot: string,
  force: boolean,
  log: FastifyInstance["log"]
): Promise<ConnectResult> {
  if (force) await resetWhatsAppSession(businessId, sessionsRoot);

  const client = ensureWhatsAppClient(waManager, sessionsRoot, businessId);

  if (client.isConnected()) {
    await setBusinessConnected(businessId, true);
    return { status: "already_connected" };
  }

  if (client.lastQrDataUrl && !force) {
    return { status: "qr", qr: client.lastQrDataUrl };
  }

  try {
    await client.kickPairing();
  } catch (err) {
    log.error({ err }, "whatsapp kickPairing failed");
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Falha ao iniciar sessão WhatsApp",
    };
  }

  const result = await waitForQr(client, 22_000);
  if (result.qr || client.isConnected()) return result;
  if (client.lastQrDataUrl) {
    return { status: "qr", qr: client.lastQrDataUrl };
  }

  if (!force && hasStoredSession(sessionsRoot, businessId)) {
    log.warn({ businessId }, "whatsapp connect retry after stale session");
    await resetWhatsAppSession(businessId, sessionsRoot);
    const fresh = ensureWhatsAppClient(waManager, sessionsRoot, businessId);
    try {
      await fresh.kickPairing();
    } catch (err) {
      log.error({ err }, "whatsapp kickPairing retry failed");
      return {
        status: "error",
        message: err instanceof Error ? err.message : "Falha ao iniciar sessão WhatsApp",
      };
    }
    const retry = await waitForQr(fresh, 22_000);
    if (retry.qr || fresh.isConnected()) return retry;
    if (fresh.lastQrDataUrl) {
      return { status: "qr", qr: fresh.lastQrDataUrl };
    }
  }

  return {
    status: "connecting",
    message: "Gerando QR Code. Aguarde nesta tela — o status atualiza sozinho.",
  };
}

export async function whatsappRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  const sessionsRoot = process.env.WA_SESSION_PATH?.trim();
  if (!sessionsRoot) throw new Error("WA_SESSION_PATH é obrigatório.");

  app.post("/businesses/:id/whatsapp/connect", async (req, reply) => {
    if (!isWhatsAppRuntime()) return waUnavailable(reply);

    const { id } = req.params as { id: string };
    const force = (req.query as { force?: string }).force === "1";
    const business = await getBusiness(id, req.tenantId);
    if (!business) return reply.status(404).send({ error: "Negócio não encontrado" });

    try {
      const result = await connectForQr(id, sessionsRoot, force, req.log);
      if (result.status === "already_connected" || waManager.get(id)?.isConnected()) {
        await setBusinessConnected(id, true);
      }
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, "whatsapp connect failed");
      return reply.status(500).send({
        status: "error",
        message: err instanceof Error ? err.message : "Falha ao gerar QR Code",
      });
    }
  });

  app.get("/businesses/:id/whatsapp/status", async (req, reply) => {
    if (!isWhatsAppRuntime()) {
      return { connected: false, status: "unavailable", message: "API sem suporte a WhatsApp" };
    }

    const { id } = req.params as { id: string };
    const business = await getBusiness(id, req.tenantId);
    if (!business) return reply.status(404).send({ error: "Negócio não encontrado" });

    let client = waManager.get(id);
    if (!client) {
      client = ensureWhatsAppClient(waManager, sessionsRoot, id);
    }
    const connected = client?.isConnected() ?? false;
    if (connected !== business.isConnected) {
      await setBusinessConnected(id, connected);
    }
    return {
      connected,
      status: client?.status ?? "disconnected",
      qr: !connected && client?.lastQrDataUrl ? client.lastQrDataUrl : undefined,
    };
  });

  app.post("/businesses/:id/whatsapp/disconnect", async (req, reply) => {
    if (!isWhatsAppRuntime()) return waUnavailable(reply);

    const { id } = req.params as { id: string };
    const business = await getBusiness(id, req.tenantId);
    if (!business) return reply.status(404).send({ error: "Negócio não encontrado" });

    await teardownWhatsAppSession(id);
    return { status: "disconnected" };
  });

  app.post("/businesses/:id/whatsapp/send", async (req, reply) => {
    if (!isWhatsAppRuntime()) return waUnavailable(reply);

    const { id } = req.params as { id: string };
    const { to, text, conversationId } = req.body as {
      to: string;
      text: string;
      conversationId?: string;
    };
    if (!to?.trim() || !text?.trim()) {
      return reply.status(400).send({ error: "Destino e mensagem são obrigatórios" });
    }

    const business = await getBusiness(id, req.tenantId);
    if (!business) return reply.status(404).send({ error: "Negócio não encontrado" });

    const client = await resolveWhatsAppClient(waManager, sessionsRoot, id, { waitMs: 12_000 });
    if (!client) {
      await setBusinessConnected(id, false);
      return reply.status(400).send({
        error: "WhatsApp desconectado. Abra Conexão WhatsApp e escaneie o QR de novo.",
      });
    }

    let convId = conversationId;
    let dest = to.trim();
    if (convId) {
      const conv = await getConversation(id, convId);
      if (!conv) return reply.status(404).send({ error: "Conversa não encontrada" });
      dest = conv.replyJid?.trim() || conv.customerPhone?.trim() || dest;
    } else {
      const conv = await upsertConversation(id, to.trim());
      convId = conv.id;
      dest = conv.replyJid?.trim() || conv.customerPhone?.trim() || dest;
    }

    const waMessageId = await client.sendText(dest, text.trim());
    const message = await createMessage(id, convId, {
      role: "HUMAN",
      content: text.trim(),
    });

    return { messageId: waMessageId, message };
  });

  app.post("/businesses/:id/whatsapp/send-media", async (req, reply) => {
    if (!isWhatsAppRuntime()) return waUnavailable(reply);

    const { id } = req.params as { id: string };
    const business = await getBusiness(id, req.tenantId);
    if (!business) return reply.status(404).send({ error: "Negócio não encontrado" });

    let conversationId = "";
    let caption = "";
    let fileBuffer: Buffer | null = null;
    let mimetype = "";

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        fileBuffer = await part.toBuffer();
        mimetype = part.mimetype;
      } else if (part.fieldname === "conversationId") {
        conversationId = String(part.value ?? "").trim();
      } else if (part.fieldname === "text") {
        caption = String(part.value ?? "").trim();
      }
    }

    if (!conversationId) {
      return reply.status(400).send({ error: "conversationId é obrigatório" });
    }
    if (!fileBuffer?.length) {
      return reply.status(400).send({ error: "Arquivo de mídia é obrigatório" });
    }

    const conv = await getConversation(id, conversationId);
    if (!conv) return reply.status(404).send({ error: "Conversa não encontrada" });

    const client = await resolveWhatsAppClient(waManager, sessionsRoot, id, { waitMs: 12_000 });
    if (!client) {
      await setBusinessConnected(id, false);
      return reply.status(400).send({
        error: "WhatsApp desconectado. Abra Conexão WhatsApp e escaneie o QR de novo.",
      });
    }

    let mediaUrl: string;
    let mediaType: "image" | "video" | "audio";
    try {
      const saved = await saveChatMedia(id, fileBuffer, mimetype);
      mediaUrl = saved.mediaUrl;
      mediaType = saved.mediaType;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload inválido";
      return reply.status(400).send({ error: message });
    }

    const dest = conv.replyJid?.trim() || conv.customerPhone?.trim();
    if (!dest) return reply.status(400).send({ error: "Destino da conversa inválido" });

    const waMessageId = await client.sendChatMedia(dest, mediaUrl, mediaType, caption);
    const content =
      caption ||
      (mediaType === "image" ? "[imagem]" : mediaType === "video" ? "[video]" : "[audio]");
    const message = await createMessage(id, conversationId, {
      role: "HUMAN",
      content,
      mediaUrl,
      mediaType,
      waMessageId,
    });

    return { messageId: waMessageId, message };
  });

  app.post("/businesses/:id/whatsapp/status/upload", async (req, reply) => {
    if (!isWhatsAppRuntime()) return waUnavailable(reply);

    const { id } = req.params as { id: string };
    const business = await getBusiness(id, req.tenantId);
    if (!business) return reply.status(404).send({ error: "Negócio não encontrado" });

    const part = await req.file();
    if (!part) return reply.status(400).send({ error: "Arquivo obrigatório" });

    try {
      const buffer = await part.toBuffer();
      const result = await saveStatusMedia(id, buffer, part.mimetype);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload inválido";
      return reply.status(400).send({ error: message });
    }
  });
}
