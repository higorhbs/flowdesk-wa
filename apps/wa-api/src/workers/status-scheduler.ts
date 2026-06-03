import {
  claimScheduledStatus,
  finishScheduledStatus,
  listDueScheduledStatuses,
  listStatusAudienceJids,
  setBusinessConnected,
} from "@flowdesk/firebase";
import type { WhatsAppManager } from "@flowdesk/whatsapp-client";
import { resolveWhatsAppClient } from "../wa-lifecycle.js";

const TICK_MS = 30_000;
const GAP_BETWEEN_POSTS_MS = 8_000;

async function publishOne(waManager: WhatsAppManager, post: { businessId: string; id: string }) {
  const claimed = await claimScheduledStatus(post.businessId, post.id);
  if (!claimed) return;

  const sessionsRoot = process.env.WA_SESSION_PATH?.trim();
  if (!sessionsRoot) {
    await finishScheduledStatus(post.businessId, post.id, {
      status: "failed",
      error: "WA_SESSION_PATH não configurado",
    });
    return;
  }

  const client = await resolveWhatsAppClient(waManager, sessionsRoot, post.businessId, {
    waitMs: 15_000,
  });
  if (!client) {
    await setBusinessConnected(post.businessId, false);
    await finishScheduledStatus(post.businessId, post.id, {
      status: "failed",
      error: "WhatsApp desconectado na hora da publicação",
    });
    return;
  }

  try {
    const audience = await listStatusAudienceJids(post.businessId);
    const msgId = await client.publishStatus({
      mediaUrl: claimed.mediaUrl,
      mediaType: claimed.mediaType,
      caption: claimed.caption,
      statusJidList: audience,
    });
    await finishScheduledStatus(post.businessId, post.id, { status: "published" });
    console.log(
      `[status] published business=${post.businessId} id=${post.id} waMsg=${msgId ?? "-"} audience=${audience.length}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao publicar status";
    await finishScheduledStatus(post.businessId, post.id, { status: "failed", error: message });
    console.error(`[status] failed business=${post.businessId} id=${post.id}:`, message);
  }
}

export function startStatusScheduler(waManager: WhatsAppManager) {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const due = await listDueScheduledStatuses();
      for (const post of due) {
        await publishOne(waManager, { businessId: post.businessId, id: post.id });
        await new Promise((r) => setTimeout(r, GAP_BETWEEN_POSTS_MS));
      }
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(() => {
    void run().catch((err) => console.error("[status-scheduler] tick error:", err));
  }, TICK_MS);

  console.log("[status-scheduler] started");
}
