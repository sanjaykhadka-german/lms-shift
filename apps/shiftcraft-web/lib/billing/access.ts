import "server-only";
import { getSubscription, type TenantSubscription } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isPlatformAdmin } from "~/lib/auth/platform-allowlist";

export type AccessLevel = "full" | "read_only" | "blocked";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const APP = "shiftcraft" as const;

/**
 * Whether the ShiftCraft entitlement gate is enforced. OFF by default so the
 * gate ships dormant: deploy the code, backfill `tenant_subscriptions` rows
 * for the existing prod tenants, smoke-test, THEN flip
 * SHIFTCRAFT_BILLING_ENFORCED=true. This prevents a deploy from locking out
 * the 6 live tenants before their rows exist.
 */
export function isBillingEnforced(): boolean {
  return process.env.SHIFTCRAFT_BILLING_ENFORCED === "true";
}

/**
 * Decide what a tenant can do based on its ShiftCraft subscription row.
 * Mirrors lms-web's accessLevelFor but reads the per-app
 * `tenant_subscriptions` row instead of the legacy `tenants` columns.
 *
 * - no row / unknown status              → blocked (fail closed)
 * - canceled                             → blocked
 * - past_due, within 7d of period-end    → read_only (Stripe dunning grace)
 * - past_due, beyond 7d                  → blocked
 * - trialing, trial in the future        → full
 * - trialing, trial expired              → read_only (never-paid keep view access)
 * - active                               → full
 */
export function accessLevelFor(
  sub: Pick<
    TenantSubscription,
    "status" | "trialEndsAt" | "currentPeriodEnd"
  > | null | undefined,
  now: Date = new Date(),
): AccessLevel {
  if (!sub) return "blocked";
  switch (sub.status) {
    case "active":
      return "full";

    case "trialing":
      if (sub.trialEndsAt && sub.trialEndsAt.getTime() > now.getTime()) {
        return "full";
      }
      return "read_only";

    case "past_due": {
      const periodEnd = sub.currentPeriodEnd?.getTime() ?? null;
      if (periodEnd === null) return "read_only";
      if (periodEnd + SEVEN_DAYS_MS > now.getTime()) return "read_only";
      return "blocked";
    }

    case "canceled":
      return "blocked";

    default:
      return "blocked";
  }
}

export interface ShiftcraftAccess {
  tenantId: string;
  subscription: TenantSubscription | undefined;
  level: AccessLevel;
  /** Platform admins bypass the gate so support can debug a frozen tenant. */
  bypassed: boolean;
}

/** Effective ShiftCraft access for the current request, with admin bypass. */
export async function getShiftcraftAccess(): Promise<ShiftcraftAccess | null> {
  const m = await currentMembership();
  if (!m) return null;
  const user = await currentUser();
  const bypassed = !!user && isPlatformAdmin(user.email);
  const subscription = await getSubscription(m.tenant.id, APP);
  const level: AccessLevel = bypassed ? "full" : accessLevelFor(subscription);
  return { tenantId: m.tenant.id, subscription, level, bypassed };
}

/**
 * Subclass of Error so server actions can branch on it (surface a friendly
 * form error rather than a 500). Throwing is the right shape for server
 * actions because they don't have access to NextResponse.
 */
export class BillingGateError extends Error {
  readonly level: AccessLevel;
  constructor(level: AccessLevel) {
    super("subscription_required");
    this.name = "BillingGateError";
    this.level = level;
  }
}

/**
 * Server-action guard. No-op when the gate is disabled or the tenant has full
 * access; otherwise throws BillingGateError so the action aborts before
 * mutating anything. Platform admins always pass.
 */
export async function assertWriteAccess(): Promise<void> {
  if (!isBillingEnforced()) return;
  const access = await getShiftcraftAccess();
  if (!access) throw new BillingGateError("blocked");
  if (access.level === "full") return;
  throw new BillingGateError(access.level);
}
