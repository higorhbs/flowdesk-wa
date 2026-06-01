import { PLAN_PRICES, type PlanTier } from "./index.js";

export function planPriceBrlCents(plan: PlanTier): number {
  return Math.round(PLAN_PRICES[plan].brl * 100);
}

export function stripePriceMismatchMessage(plan: PlanTier, unitAmount: number | null | undefined): string | null {
  const expected = planPriceBrlCents(plan);
  if (unitAmount === expected) return null;
  const got =
    unitAmount == null ? "?" : (unitAmount / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  const want = PLAN_PRICES[plan].brl.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  return `Preço Stripe do ${PLAN_PRICES[plan].label} está R$ ${got}; esperado R$ ${want}. Rode pnpm stripe:sync-prices e atualize STRIPE_PRICE_${plan} na VM.`;
}
