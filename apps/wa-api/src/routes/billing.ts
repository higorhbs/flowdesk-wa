import { FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import Stripe from "stripe";
import { PLAN_PRICES, APP_DISPLAY_NAME } from "@flowdesk/shared";
import { createTenant, getAdminAuth, getTenant, updateTenant } from "@flowdesk/firebase";
import type { Tenant } from "@flowdesk/firebase";
import { requireAuth } from "../middleware/auth";
import {
  getSubscriptionAccessEndIso,
  isSubscriptionCancelPending,
  subscriptionCancelPatch,
  type StripeSubscriptionPayload,
} from "../services/stripe-subscription.js";

const planSchema = z.object({
  plan: z.enum(["STARTER", "PRO", "UNLIMITED"]),
});

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY não configurada no servidor.");
  return new Stripe(key);
}

function resolveBillingOrigin(req: FastifyRequest): string {
  const origin = req.headers.origin?.trim();
  if (origin) return origin;

  const referer = req.headers.referer?.trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* ignore */
    }
  }

  const fromCors = process.env.CORS_ORIGIN?.split(",")
    .map((o) => o.trim())
    .find(Boolean);
  if (fromCors) return fromCors;

  const webOrigin = process.env.WEB_ORIGIN?.trim();
  if (webOrigin) return webOrigin;

  throw new Error("URL do app não detectada. Configure CORS_ORIGIN na API.");
}

async function ensureBillingTenant(req: FastifyRequest): Promise<Tenant> {
  const existing = await getTenant(req.tenantId);
  if (existing) return existing;

  let email = req.tenantEmail?.trim();
  if (!email) {
    const user = await getAdminAuth().getUser(req.tenantId);
    email = user.email?.trim();
  }
  if (!email) {
    throw new Error("E-mail da conta não encontrado. Atualize o perfil e tente novamente.");
  }

  return createTenant(req.tenantId, {
    name: email.split("@")[0] ?? "Usuário",
    email,
  });
}

function sendBillingError(req: FastifyRequest, reply: FastifyReply, err: unknown) {
  if (err instanceof z.ZodError) {
    return reply.status(400).send({ error: "Plano inválido." });
  }

  const stripeErr = err as { type?: string; message?: string };
  if (stripeErr?.type?.startsWith("Stripe")) {
    req.log.warn({ err: stripeErr }, "stripe checkout failed");
    return reply.status(502).send({
      error: stripeErr.message || "Stripe recusou a operação. Verifique os preços configurados.",
    });
  }

  const message = err instanceof Error ? err.message : "Erro ao iniciar checkout.";
  if (/STRIPE_|Preço Stripe|Stripe não/i.test(message)) {
    return reply.status(503).send({ error: message });
  }
  if (/Origin|CORS_ORIGIN|URL do app/i.test(message)) {
    return reply.status(400).send({ error: message });
  }
  if (/E-mail da conta/i.test(message)) {
    return reply.status(400).send({ error: message });
  }

  req.log.error({ err }, "billing route failed");
  return reply.status(500).send({ error: message });
}

function planPriceId(plan: "STARTER" | "PRO" | "UNLIMITED"): string {
  const map = {
    STARTER: process.env.STRIPE_PRICE_STARTER,
    PRO: process.env.STRIPE_PRICE_PRO,
    UNLIMITED: process.env.STRIPE_PRICE_UNLIMITED,
  } as const;
  const price = map[plan];
  if (!price) throw new Error(`Preço Stripe não configurado para plano ${plan}`);
  return price;
}

function planFromPriceId(priceId: string | null | undefined): Tenant["plan"] | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "STARTER";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "PRO";
  if (priceId === process.env.STRIPE_PRICE_UNLIMITED) return "UNLIMITED";
  return null;
}

const ACTIVE_SUB_STATUSES = ["active", "trialing", "past_due", "unpaid"] as const;

type StripeSubscription = StripeSubscriptionPayload;

function getSubscriptionBillingPeriod(sub: StripeSubscription): { start: number; end: number } | null {
  const item = sub.items?.data?.[0];
  const start = sub.current_period_start ?? item?.current_period_start;
  const end =
    (typeof sub.cancel_at === "number" ? sub.cancel_at : null) ??
    sub.current_period_end ??
    item?.current_period_end;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start, end };
}

async function findActiveSubscriptionForCustomer(
  stripe: ReturnType<typeof getStripe>,
  customerId: string,
  subscriptionId?: string
): Promise<StripeSubscription | null> {
  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      if (ACTIVE_SUB_STATUSES.includes(sub.status as (typeof ACTIVE_SUB_STATUSES)[number])) {
        return sub;
      }
    } catch {
      /* tenta listar pelo customer */
    }
  }

  const list = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
  });
  return (
    list.data.find((item) =>
      ACTIVE_SUB_STATUSES.includes(item.status as (typeof ACTIVE_SUB_STATUSES)[number])
    ) ?? null
  );
}

async function resolveStripeCustomerId(
  stripe: ReturnType<typeof getStripe>,
  tenant: Tenant
): Promise<string | null> {
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;
  if (!tenant.email) return null;

  const customers = await stripe.customers.list({ email: tenant.email, limit: 20 });
  const byMeta = customers.data.find((c) => c.metadata?.tenantId === tenant.id);
  if (byMeta) return byMeta.id;

  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 5 });
    const active = subs.data.find((s) =>
      ACTIVE_SUB_STATUSES.includes(s.status as (typeof ACTIVE_SUB_STATUSES)[number])
    );
    if (active) return customer.id;
  }

  return customers.data[0]?.id ?? null;
}

async function reconcileTenantBilling(
  stripe: ReturnType<typeof getStripe>,
  tenant: Tenant
): Promise<Tenant> {
  const customerId = await resolveStripeCustomerId(stripe, tenant);
  if (!customerId) return tenant;

  const sub = await findActiveSubscriptionForCustomer(stripe, customerId, tenant.stripeSubscriptionId);
  const priceId = sub?.items?.data?.[0]?.price?.id;
  const plan = planFromPriceId(priceId);

  const patch: Partial<Tenant> = {};
  if (customerId !== tenant.stripeCustomerId) patch.stripeCustomerId = customerId;
  if (sub?.id && sub.id !== tenant.stripeSubscriptionId) patch.stripeSubscriptionId = sub.id;
  if (sub && priceId) patch.stripePriceId = priceId;
  if (sub && plan) patch.plan = plan;

  if (sub) {
    const resolvedPlan = plan ?? tenant.plan;
    const planStatus =
      sub.status === "past_due" || sub.status === "unpaid"
        ? "PAST_DUE"
        : sub.status === "trialing" && resolvedPlan === "STARTER"
          ? "TRIALING"
          : "ACTIVE";
    if (tenant.planStatus !== planStatus) patch.planStatus = planStatus;

    const period = getSubscriptionBillingPeriod(sub);
    const accessEnd = getSubscriptionAccessEndIso(sub);
    if (accessEnd) patch.currentPeriodEnd = accessEnd;
    else if (period) patch.currentPeriodEnd = new Date(period.end * 1000).toISOString();

    Object.assign(patch, subscriptionCancelPatch(sub, tenant));
    if (isSubscriptionCancelPending(sub) && sub.status === "active") {
      patch.planStatus = "ACTIVE";
    }
  } else if (
    tenant.stripeCustomerId &&
    tenant.planStatus !== "TRIALING" &&
    tenant.planStatus !== "CANCELED"
  ) {
    const graceEnd = tenant.currentPeriodEnd ? new Date(tenant.currentPeriodEnd).getTime() : 0;
    const inGrace = graceEnd > Date.now() && (tenant.cancelAtPeriodEnd || tenant.canceledAt);
    if (!inGrace) {
      patch.planStatus = "CANCELED";
      patch.cancelAtPeriodEnd = false;
      patch.stripeSubscriptionId = undefined;
      if (!tenant.canceledAt) patch.canceledAt = new Date().toISOString();
    }
  }

  if (Object.keys(patch).length === 0) {
    return tenant.stripeCustomerId ? tenant : { ...tenant, stripeCustomerId: customerId };
  }

  const updated = await updateTenant(tenant.id, patch);
  return updated ?? { ...tenant, ...patch };
}

async function resolveSubscription(
  stripe: ReturnType<typeof getStripe>,
  tenant: Tenant
): Promise<StripeSubscription | null> {
  if (!tenant.stripeCustomerId) return null;
  return findActiveSubscriptionForCustomer(stripe, tenant.stripeCustomerId, tenant.stripeSubscriptionId);
}

export async function billingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.post("/billing/sync", async (req, reply) => {
    try {
      const stripe = getStripe();
      const tenant = await reconcileTenantBilling(stripe, await ensureBillingTenant(req));
      const sub = tenant.stripeCustomerId
        ? await resolveSubscription(stripe, tenant)
        : null;
      return {
        ok: true,
        plan: tenant.plan,
        planStatus: tenant.planStatus,
        stripeCustomerId: tenant.stripeCustomerId ?? null,
        stripeSubscriptionId: tenant.stripeSubscriptionId ?? null,
        subscriptionStatus: sub?.status ?? null,
        cancelAtPeriodEnd: tenant.cancelAtPeriodEnd ?? false,
        currentPeriodEnd: tenant.currentPeriodEnd ?? null,
        canceledAt: tenant.canceledAt ?? null,
      };
    } catch (err) {
      return sendBillingError(req, reply, err);
    }
  });

  app.post("/billing/checkout", async (req, reply) => {
    try {
      const { plan } = planSchema.parse(req.body ?? {});
      const tenant = await ensureBillingTenant(req);

      const stripe = getStripe();
      let customerId = tenant.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: tenant.email,
          name: tenant.name,
          metadata: { tenantId: tenant.id },
        });
        customerId = customer.id;
        await updateTenant(tenant.id, { stripeCustomerId: customerId });
      }

      const origin = resolveBillingOrigin(req);
      const priceId = planPriceId(plan);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: tenant.id,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/plan?checkout=success`,
        cancel_url: `${origin}/plan?checkout=cancel`,
        allow_promotion_codes: true,
        metadata: { tenantId: tenant.id, plan, planPriceId: priceId },
        subscription_data: {
          metadata: { tenantId: tenant.id, plan, planPriceId: priceId },
          description: `${APP_DISPLAY_NAME} ${PLAN_PRICES[plan].label}`,
        },
      });

      if (!session.url) {
        return reply.status(502).send({ error: "Stripe não retornou URL de checkout." });
      }

      return { url: session.url };
    } catch (err) {
      return sendBillingError(req, reply, err);
    }
  });

  app.post("/billing/portal", async (req, reply) => {
    try {
      const stripe = getStripe();
      const tenant = await reconcileTenantBilling(stripe, await ensureBillingTenant(req));
      if (!tenant.stripeCustomerId) {
        return reply.status(400).send({ error: "Nenhum cliente Stripe vinculado. Escolha um plano primeiro." });
      }
      const origin = resolveBillingOrigin(req);
      const portal = await stripe.billingPortal.sessions.create({
        customer: tenant.stripeCustomerId,
        return_url: `${origin}/plan`,
      });
      if (!portal.url) {
        return reply.status(502).send({ error: "Stripe não retornou URL do portal." });
      }
      return { url: portal.url };
    } catch (err) {
      return sendBillingError(req, reply, err);
    }
  });

  app.get("/billing/prices", async () => {
    return {
      STARTER: { amount: PLAN_PRICES.STARTER.brl, priceId: process.env.STRIPE_PRICE_STARTER ?? null },
      PRO: { amount: PLAN_PRICES.PRO.brl, priceId: process.env.STRIPE_PRICE_PRO ?? null },
      UNLIMITED: { amount: PLAN_PRICES.UNLIMITED.brl, priceId: process.env.STRIPE_PRICE_UNLIMITED ?? null },
    };
  });
}
