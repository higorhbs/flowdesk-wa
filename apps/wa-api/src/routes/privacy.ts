import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, getTenant } from "@flowdesk/firebase";
import { requireAuth } from "../middleware/auth.js";
import { runPrivacyRetentionForAllTenants } from "../services/privacy-compliance.js";
import { deleteTenantAccountCompletely } from "../services/delete-account.js";

const consentBody = z.object({
  policyVersion: z.string().min(3),
});

const requestBody = z.object({
  type: z.enum(["CORRECTION", "OPPOSITION", "REVOCATION", "ERASURE"]),
  details: z.string().max(2000).optional(),
});

function maskPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits ? `anon-${digits.slice(-4)}` : "anon";
}

async function anonymizeTenantData(tenantId: string) {
  const db = getDb();
  const businessesSnap = await db.collection("businesses").where("tenantId", "==", tenantId).get();

  for (const businessDoc of businessesSnap.docs) {
    const businessId = businessDoc.id;
    const business = businessDoc.data() as Record<string, unknown>;
    await businessDoc.ref.update({
      phone: maskPhone(String(business.phone ?? "")),
      address: null,
      description: null,
      updatedAt: new Date().toISOString(),
    });

    const conversationsSnap = await businessDoc.ref.collection("conversations").get();
    for (const convDoc of conversationsSnap.docs) {
      const conv = convDoc.data() as Record<string, unknown>;
      await convDoc.ref.update({
        customerName: "ANONIMIZADO",
        customerPhone: maskPhone(String(conv.customerPhone ?? "")),
      });
      const messagesSnap = await convDoc.ref.collection("messages").get();
      for (const msgDoc of messagesSnap.docs) {
        await msgDoc.ref.update({ content: "[ANONIMIZADO]" });
      }
    }

    const appointmentsSnap = await businessDoc.ref.collection("appointments").get();
    for (const aptDoc of appointmentsSnap.docs) {
      const apt = aptDoc.data() as Record<string, unknown>;
      await aptDoc.ref.update({
        customerName: "ANONIMIZADO",
        customerPhone: maskPhone(String(apt.customerPhone ?? "")),
        notes: null,
      });
    }

    const paymentsSnap = await businessDoc.ref.collection("payments").get();
    for (const payDoc of paymentsSnap.docs) {
      const pay = payDoc.data() as Record<string, unknown>;
      await payDoc.ref.update({
        customerName: "ANONIMIZADO",
        customerPhone: maskPhone(String(pay.customerPhone ?? "")),
      });
    }
  }
}

export async function privacyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/privacy/export", async (req, reply) => {
    const tenantId = req.tenantId;
    const db = getDb();
    const tenant = await getTenant(tenantId);
    if (!tenant) return reply.status(404).send({ error: "Conta não encontrada" });

    const businessesSnap = await db.collection("businesses").where("tenantId", "==", tenantId).get();

    const businesses = await Promise.all(
      businessesSnap.docs.map(async (businessDoc) => {
        const businessId = businessDoc.id;
        const [catalogSnap, faqsSnap, conversationsSnap, appointmentsSnap, paymentsSnap] = await Promise.all([
          db.collection("businesses").doc(businessId).collection("catalog").get(),
          db.collection("businesses").doc(businessId).collection("faqs").get(),
          db.collection("businesses").doc(businessId).collection("conversations").get(),
          db.collection("businesses").doc(businessId).collection("appointments").get(),
          db.collection("businesses").doc(businessId).collection("payments").get(),
        ]);

        const conversations = await Promise.all(
          conversationsSnap.docs.map(async (convDoc) => {
            const messagesSnap = await db
              .collection("businesses")
              .doc(businessId)
              .collection("conversations")
              .doc(convDoc.id)
              .collection("messages")
              .get();

            return {
              id: convDoc.id,
              ...convDoc.data(),
              messages: messagesSnap.docs.map((m) => ({ id: m.id, ...m.data() })),
            };
          })
        );

        return {
          id: businessId,
          ...businessDoc.data(),
          catalog: catalogSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          faqs: faqsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          conversations,
          appointments: appointmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          payments: paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        };
      })
    );

    return {
      exportedAt: new Date().toISOString(),
      tenant,
      businesses,
    };
  });

  app.post("/privacy/consent", async (req) => {
    const { policyVersion } = consentBody.parse(req.body ?? {});
    const tenantId = req.tenantId;
    const db = getDb();
    const now = new Date().toISOString();

    await db.collection("tenants").doc(tenantId).update({
      lgpdAcceptedAt: now,
      lgpdPolicyVersion: policyVersion,
      updatedAt: now,
    });

    await db.collection("tenants").doc(tenantId).collection("privacy_audit").doc().set({
      type: "CONSENT_ACCEPTED",
      policyVersion,
      acceptedAt: now,
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? "",
    });

    return { ok: true, acceptedAt: now, policyVersion };
  });

  app.post("/privacy/requests", async (req) => {
    const tenantId = req.tenantId;
    const body = requestBody.parse(req.body ?? {});
    const db = getDb();
    const now = new Date().toISOString();
    const ref = db.collection("tenants").doc(tenantId).collection("privacy_requests").doc();
    await ref.set({
      ...body,
      status: "OPEN",
      createdAt: now,
      updatedAt: now,
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? "",
    });
    return { ok: true, requestId: ref.id };
  });

  app.post("/privacy/delete-account", async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      await deleteTenantAccountCompletely(tenantId);
      return { ok: true };
    } catch (err) {
      req.log.error({ err, tenantId }, "delete-account failed");
      return reply.status(500).send({
        error: err instanceof Error ? err.message : "Não foi possível excluir a conta.",
      });
    }
  });

  app.post("/privacy/anonymize", async (req) => {
    const tenantId = req.tenantId;
    const db = getDb();
    await anonymizeTenantData(tenantId);
    await db.collection("tenants").doc(tenantId).update({
      name: "ANONIMIZADO",
      email: `anon-${tenantId}@anonymized.local`,
      updatedAt: new Date().toISOString(),
    });
    await db.collection("tenants").doc(tenantId).collection("privacy_audit").doc().set({
      type: "ANONYMIZATION_EXECUTED",
      executedAt: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? "",
    });
    return { ok: true };
  });

  app.post("/privacy/retention/run", async () => {
    const summary = await runPrivacyRetentionForAllTenants(365);
    return { ok: true, ...summary };
  });
}
