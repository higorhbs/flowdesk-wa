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
import { ensureWhatsAppClient, resolveWhatsAppClient } from "../wa-lifecycle.js";

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

  if (client.status === "close" || client.status === "connecting") {
    if (client.status === "close") {
      void client.connect().catch((err) => {
        log.error({ err }, "whatsapp connect failed");
      });
    }
  }

  const result = await waitForQr(client, 12_000);
  if (result.qr || client.isConnected()) return result;

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
    if (client && !client.isConnected() && client.status === "close") {
      void client.connect().catch((err) => {
        req.log.error({ err }, "whatsapp reconnect failed");
      });
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

    const client = waManager.get(id);
    if (client) {
      await client.logout();
      waManager.remove(id);
      await setBusinessConnected(id, false);
    }
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
}
