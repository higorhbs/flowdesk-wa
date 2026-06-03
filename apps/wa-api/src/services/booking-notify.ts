import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Appointment, Business } from "@flowdesk/firebase";
import { getBusinessVocabulary } from "@flowdesk/shared";
import { waManager, isWhatsAppRuntime } from "../wa-manager.js";
import { createMessage, getConversation, upsertConversation } from "@flowdesk/firebase";

export async function notifyBookingAccepted(
  business: Pick<Business, "id" | "name" | "type">,
  apt: Appointment
): Promise<void> {
  if (!isWhatsAppRuntime() || apt.status !== "CONFIRMED") return;
  const client = waManager.get(business.id);
  if (!client?.isConnected() || !apt.customerPhone) return;

  const v = getBusinessVocabulary(business.type);
  const when = new Date(apt.scheduledAt);
  const text =
    `✅ *${v.botBookingAcceptedNotify}!*\n\n` +
    `🏪 *${business.name}*\n` +
    `📅 ${format(when, "dd/MM/yyyy", { locale: ptBR })} às ${format(when, "HH:mm")}\n` +
    `📋 ${apt.serviceName}\n` +
    `🔖 ${apt.id.slice(0, 8)}`;

  try {
    let convId = apt.conversationId;
    let dest = apt.customerPhone;
    if (convId) {
      const conv = await getConversation(business.id, convId);
      if (conv) dest = conv.replyJid?.trim() || conv.customerPhone || dest;
    } else {
      const conv = await upsertConversation(business.id, apt.customerPhone);
      convId = conv.id;
      dest = conv.replyJid?.trim() || conv.customerPhone;
    }
    await client.sendText(dest, text);
    await createMessage(business.id, convId, { role: "IA", content: text });
  } catch (err) {
    console.warn("[booking-notify] failed", business.id, apt.id, err);
  }
}
