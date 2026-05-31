import { Worker, Queue, type ConnectionOptions } from "bullmq";
import { processMessage, BotContext } from "../services/bot";
import { requireEnv } from "../env";
import { WhatsAppManager } from "@flowdesk/whatsapp-client";
import { resolveWhatsAppClient } from "../wa-lifecycle.js";

export interface MessageJob {
  businessId: string;
  customerPhone: string;
  customerName?: string;
  messageBody: string;
  replyJid: string;
}

export interface ReminderJob {
  appointmentId: string;
  businessId: string;
  customerPhone: string;
  message: string;
}

let messageQueue: Queue | null = null;
let reminderQueue: Queue | null = null;
let connection: ConnectionOptions | null = null;

export function getRedisConnection(): ConnectionOptions {
  if (!connection) {
    connection = {
      url: requireEnv("REDIS_URL"),
      maxRetriesPerRequest: null,
    };
  }
  return connection;
}

export function getMessageQueue(): Queue {
  if (!messageQueue) {
    messageQueue = new Queue("messages", { connection: getRedisConnection() });
  }
  return messageQueue;
}

export function getReminderQueue(): Queue {
  if (!reminderQueue) {
    reminderQueue = new Queue("reminders", { connection: getRedisConnection() });
  }
  return reminderQueue;
}

export function startMessageWorker(waManager: WhatsAppManager) {
  const worker = new Worker<MessageJob>(
    "messages",
    async (job) => {
      const { businessId, customerPhone, customerName, messageBody, replyJid } = job.data;
      const dest = replyJid?.trim() || customerPhone;

      const ctx: BotContext = {
        businessId,
        customerPhone,
        customerName,
        messageBody,
        replyJid,
      };
      const responses = await processMessage(ctx);

      const sessionsRoot = process.env.WA_SESSION_PATH?.trim();
      if (!sessionsRoot) throw new Error("WA_SESSION_PATH não configurado");

      const client = await resolveWhatsAppClient(waManager, sessionsRoot, businessId, {
        waitMs: 8_000,
      });
      if (!client) {
        console.warn(`[worker] WhatsApp not connected for business ${businessId}`);
        throw new Error("WhatsApp desconectado");
      }

      for (const resp of responses) {
        if (resp.imageUrl) {
          await client.sendImage(dest, resp.imageUrl, resp.text);
        } else if (resp.text) {
          await client.sendText(dest, resp.text);
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      console.log(`[worker] replied business=${businessId} to=${dest} count=${responses.length}`);
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}

export function startReminderWorker(waManager: WhatsAppManager) {
  const sessionsRoot = process.env.WA_SESSION_PATH?.trim();
  const worker = new Worker<ReminderJob>(
    "reminders",
    async (job) => {
      const { businessId, customerPhone, message } = job.data;
      if (!sessionsRoot) return;
      const client = await resolveWhatsAppClient(waManager, sessionsRoot, businessId, {
        waitMs: 5_000,
      });
      if (!client) return;
      await client.sendText(customerPhone, message);
    },
    { connection: getRedisConnection() }
  );

  return worker;
}
