import { upsertConversation, type Payment } from "@flowdesk/firebase";
import { formatCurrency } from "@flowdesk/shared";
import { waManager, isWhatsAppRuntime } from "../wa-manager.js";

export async function notifyPaymentReceived(payment: Payment): Promise<void> {
  if (!isWhatsAppRuntime() || payment.status !== "PAID") return;

  const client = waManager.get(payment.businessId);
  if (!client?.isConnected()) return;

  const text =
    `✅ *Pagamento confirmado!*\n\n` +
    `Recebemos *${formatCurrency(payment.amount)}* referente a:\n_${payment.description}_\n\n` +
    `Obrigado! 🙏`;

  try {
    const conv = await upsertConversation(payment.businessId, payment.customerPhone);
    const dest = conv.replyJid?.trim() || payment.customerPhone;
    await client.sendText(dest, text);
  } catch (err) {
    console.error(`[payment-notify] failed for ${payment.businessId}:`, err);
  }
}
