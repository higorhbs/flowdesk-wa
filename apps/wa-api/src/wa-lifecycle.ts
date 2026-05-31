import fs from "fs";
import path from "path";
import type { WhatsAppClient, WhatsAppManager, WhatsAppMessage } from "@flowdesk/whatsapp-client";
import { setBusinessConnected } from "@flowdesk/firebase";
import { processMessage } from "./services/bot.js";
import { getMessageQueue } from "./workers/message-worker.js";

const lifecycleAttached = new WeakSet<WhatsAppClient>();

export function hasStoredSession(sessionsRoot: string, businessId: string): boolean {
  return fs.existsSync(path.join(sessionsRoot, businessId, "creds.json"));
}

export function listStoredSessionBusinessIds(sessionsRoot: string): string[] {
  if (!fs.existsSync(sessionsRoot)) return [];
  return fs
    .readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && hasStoredSession(sessionsRoot, d.name))
    .map((d) => d.name);
}

export function attachWhatsAppLifecycle(businessId: string, client: WhatsAppClient) {
  if (lifecycleAttached.has(client)) return;
  lifecycleAttached.add(client);

  client.on("connected", async () => {
    try {
      await setBusinessConnected(businessId, true);
      attachWhatsAppMessageHandler(businessId, client);
    } catch (err) {
      console.error(`[whatsapp] failed to mark connected for ${businessId}:`, err);
    }
  });

  client.on("disconnected", async () => {
    try {
      await setBusinessConnected(businessId, false);
    } catch (err) {
      console.error(`[whatsapp] failed to mark disconnected for ${businessId}:`, err);
    }
  });
}

async function deliverBotReplies(businessId: string, client: WhatsAppClient, msg: WhatsAppMessage) {
  const responses = await processMessage({
    businessId,
    customerPhone: msg.from,
    customerName: msg.pushName,
    messageBody: msg.body,
    replyJid: msg.replyJid,
  });

  if (responses.length === 0) {
    console.log(`[whatsapp] no bot reply business=${businessId} from=${msg.from}`);
    return;
  }

  const dest = msg.replyJid || msg.from;
  for (const resp of responses) {
    if (resp.imageUrl) {
      await client.sendImage(dest, resp.imageUrl, resp.text);
    } else if (resp.text) {
      await client.sendText(dest, resp.text);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  console.log(`[whatsapp] replied business=${businessId} to=${dest} count=${responses.length}`);
}

async function enqueueInbound(businessId: string, msg: WhatsAppMessage) {
  const queue = getMessageQueue();
  const jobId = msg.messageId ? `${businessId}_${msg.messageId}` : undefined;
  await queue.add(
    "inbound",
    {
      businessId,
      customerPhone: msg.from,
      customerName: msg.pushName,
      messageBody: msg.body,
      replyJid: msg.replyJid,
    },
    {
      jobId,
      removeOnComplete: true,
      removeOnFail: 50,
      attempts: 3,
      backoff: { type: "exponential", delay: 1500 },
    }
  );
}

export function attachWhatsAppMessageHandler(businessId: string, client: WhatsAppClient) {
  const flag = "__flowdeskMsgHandler" as const;
  if ((client as unknown as Record<string, boolean>)[flag]) return;
  (client as unknown as Record<string, boolean>)[flag] = true;

  client.on("message", (msg) => {
    void (async () => {
      console.log(
        `[whatsapp] inbound business=${businessId} from=${msg.from} reply=${msg.replyJid} body=${msg.body.slice(0, 60)}`
      );
      try {
        await enqueueInbound(businessId, msg);
      } catch (err) {
        console.error(`[whatsapp] queue failed business=${businessId}, direct fallback:`, err);
        try {
          await deliverBotReplies(businessId, client, msg);
        } catch (directErr) {
          console.error(`[whatsapp] direct fallback failed business=${businessId}:`, directErr);
        }
      }
    })();
  });
}

export function ensureWhatsAppClient(
  waManager: WhatsAppManager,
  sessionsRoot: string,
  businessId: string
): WhatsAppClient {
  const client = waManager.getOrCreate(businessId, sessionsRoot);
  attachWhatsAppLifecycle(businessId, client);
  attachWhatsAppMessageHandler(businessId, client);
  return client;
}

export async function resolveWhatsAppClient(
  waManager: WhatsAppManager,
  sessionsRoot: string,
  businessId: string,
  opts?: { waitMs?: number }
): Promise<WhatsAppClient | null> {
  const client = ensureWhatsAppClient(waManager, sessionsRoot, businessId);
  if (client.isConnected()) return client;

  if (client.status === "close") {
    void client.connect().catch((err) => {
      console.error(`[whatsapp] resolve connect failed for ${businessId}:`, err);
    });
  }

  const waitMs = opts?.waitMs ?? 0;
  if (waitMs > 0) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (client.isConnected()) return client;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return client.isConnected() ? client : null;
}

export async function restoreWhatsAppSessions(
  waManager: WhatsAppManager,
  sessionsRoot: string
): Promise<void> {
  const ids = listStoredSessionBusinessIds(sessionsRoot);
  if (ids.length === 0) return;
  console.log(`[whatsapp] Restoring ${ids.length} stored session(s)...`);
  for (const id of ids) {
    const client = ensureWhatsAppClient(waManager, sessionsRoot, id);
    if (client.isConnected()) continue;
    void client.connect().catch((err) => {
      console.error(`[whatsapp] restore connect failed for ${id}:`, err);
    });
  }
}
