export type StripeSubscriptionPayload = {
  id?: string;
  status?: string;
  cancel_at?: number | null;
  cancel_at_period_end?: boolean;
  canceled_at?: number | null;
  current_period_end?: number | null;
  current_period_start?: number | null;
  items?: {
    data?: Array<{
      current_period_end?: number | null;
      current_period_start?: number | null;
      price?: { id?: string | null } | null;
    }>;
  };
};

export function getSubscriptionAccessEndIso(sub: StripeSubscriptionPayload): string | null {
  const item = sub.items?.data?.[0];
  const endUnix =
    (typeof sub.cancel_at === "number" ? sub.cancel_at : null) ??
    (typeof sub.current_period_end === "number" ? sub.current_period_end : null) ??
    (typeof item?.current_period_end === "number" ? item.current_period_end : null) ??
    null;
  if (typeof endUnix !== "number") return null;
  return new Date(endUnix * 1000).toISOString();
}

export function getSubscriptionCanceledAtIso(sub: StripeSubscriptionPayload): string | null {
  if (typeof sub.canceled_at !== "number") return null;
  return new Date(sub.canceled_at * 1000).toISOString();
}

export function isSubscriptionCancelPending(sub: StripeSubscriptionPayload): boolean {
  return Boolean(sub.cancel_at_period_end) || (typeof sub.cancel_at === "number" && sub.status === "active");
}

export function subscriptionCancelPatch(
  sub: StripeSubscriptionPayload,
  tenant: { canceledAt?: string; cancelAtPeriodEnd?: boolean }
): {
  cancelAtPeriodEnd: boolean;
  canceledAt?: string;
  currentPeriodEnd?: string;
} {
  const cancelAtPeriodEnd = isSubscriptionCancelPending(sub);
  const patch: {
    cancelAtPeriodEnd: boolean;
    canceledAt?: string;
    currentPeriodEnd?: string;
  } = { cancelAtPeriodEnd };

  const accessEnd = getSubscriptionAccessEndIso(sub);
  if (accessEnd) patch.currentPeriodEnd = accessEnd;

  const stripeCanceledAt = getSubscriptionCanceledAtIso(sub);
  if (stripeCanceledAt) {
    patch.canceledAt = stripeCanceledAt;
  } else if (cancelAtPeriodEnd && !tenant.canceledAt) {
    patch.canceledAt = new Date().toISOString();
  }

  if (!cancelAtPeriodEnd && tenant.cancelAtPeriodEnd) {
    patch.cancelAtPeriodEnd = false;
  }

  return patch;
}
