import Stripe from "stripe";
import {
  deleteTenantFirestoreData,
  getAdminAuth,
  getTenant,
  listTenantBusinessIds,
} from "@flowdesk/firebase";
import { teardownWhatsAppSession } from "../wa-lifecycle.js";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key);
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

export async function deleteTenantAccountCompletely(tenantId: string) {
  const businessIds = await listTenantBusinessIds(tenantId);
  for (const businessId of businessIds) {
    await teardownWhatsAppSession(businessId);
  }

  await cancelStripeBilling(tenantId);
  await deleteTenantFirestoreData(tenantId);

  try {
    await getAdminAuth().deleteUser(tenantId);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "auth/user-not-found") throw err;
  }
}
