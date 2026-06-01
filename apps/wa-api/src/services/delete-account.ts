import Stripe from "stripe";
import { getAdminAuth, getDb, getTenant } from "@flowdesk/firebase";
import { teardownWhatsAppSession } from "../wa-lifecycle.js";

type Db = ReturnType<typeof getDb>;
type CollRef = ReturnType<Db["collection"]>;

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key);
}

async function wipeCollection(db: Db, collPath: CollRef) {
  while (true) {
    const snap = await collPath.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function deleteBusinessTree(db: Db, businessId: string) {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) return;

  const conversations = await businessRef.collection("conversations").get();
  for (const conv of conversations.docs) {
    await wipeCollection(db, conv.ref.collection("messages"));
    await conv.ref.delete();
  }

  for (const sub of ["catalog", "faqs", "appointments", "payments", "integrations"] as const) {
    await wipeCollection(db, businessRef.collection(sub));
  }

  await businessRef.delete();
}

async function cancelStripeBilling(tenantId: string) {
  const tenant = await getTenant(tenantId);
  if (!tenant) return;

  const stripe = getStripe();
  if (!stripe) return;

  if (tenant.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(tenant.stripeSubscriptionId);
    } catch {
      /* already canceled */
    }
  }

  if (tenant.stripeCustomerId) {
    try {
      await stripe.customers.del(tenant.stripeCustomerId);
    } catch {
      /* ignore */
    }
  }
}

async function deleteTenantTree(db: Db, tenantId: string) {
  const tenantRef = db.collection("tenants").doc(tenantId);
  for (const sub of ["privacy_audit", "privacy_requests"] as const) {
    await wipeCollection(db, tenantRef.collection(sub));
  }
  await tenantRef.delete();
}

export async function deleteTenantAccountCompletely(tenantId: string) {
  const db = getDb();
  const businessesSnap = await db.collection("businesses").where("tenantId", "==", tenantId).get();

  for (const doc of businessesSnap.docs) {
    await teardownWhatsAppSession(doc.id);
    await deleteBusinessTree(db, doc.id);
  }

  await cancelStripeBilling(tenantId);
  await deleteTenantTree(db, tenantId);

  try {
    await getAdminAuth().deleteUser(tenantId);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "auth/user-not-found") throw err;
  }
}
