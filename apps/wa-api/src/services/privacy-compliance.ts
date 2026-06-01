import { getDb } from "@flowdesk/firebase";

type RetentionSummary = {
  processedBusinesses: number;
  deletedMessages: number;
  deletedConversations: number;
  deletedAppointments: number;
  deletedPayments: number;
};

export async function runPrivacyRetentionForAllTenants(retentionDays = 365): Promise<RetentionSummary> {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const businessesSnap = await db.collection("businesses").get();

  const summary: RetentionSummary = {
    processedBusinesses: 0,
    deletedMessages: 0,
    deletedConversations: 0,
    deletedAppointments: 0,
    deletedPayments: 0,
  };

  for (const businessDoc of businessesSnap.docs) {
    const businessId = businessDoc.id;
    summary.processedBusinesses++;

    const conversationsSnap = await db.collection("businesses").doc(businessId).collection("conversations").get();
    for (const convDoc of conversationsSnap.docs) {
      const convData = convDoc.data() as Record<string, unknown>;
      const lastMessageAt = String(convData.lastMessageAt ?? convData.createdAt ?? "");
      if (lastMessageAt && lastMessageAt < cutoff) {
        const messagesSnap = await convDoc.ref.collection("messages").get();
        for (const msg of messagesSnap.docs) {
          await msg.ref.delete();
          summary.deletedMessages++;
        }
        await convDoc.ref.delete();
        summary.deletedConversations++;
      }
    }

    const appointmentsSnap = await db.collection("businesses").doc(businessId).collection("appointments").get();
    for (const aptDoc of appointmentsSnap.docs) {
      const apt = aptDoc.data() as Record<string, unknown>;
      const scheduledAt = String(apt.scheduledAt ?? apt.createdAt ?? "");
      if (scheduledAt && scheduledAt < cutoff) {
        await aptDoc.ref.delete();
        summary.deletedAppointments++;
      }
    }

    const paymentsSnap = await db.collection("businesses").doc(businessId).collection("payments").get();
    for (const payDoc of paymentsSnap.docs) {
      const pay = payDoc.data() as Record<string, unknown>;
      const dueDate = String(pay.dueDate ?? pay.createdAt ?? "");
      if (dueDate && dueDate < cutoff) {
        await payDoc.ref.delete();
        summary.deletedPayments++;
      }
    }
  }

  return summary;
}
