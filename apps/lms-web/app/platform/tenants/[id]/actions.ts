"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, tenants } from "@tracey/db";
import { requirePlatformAdmin } from "~/lib/auth/platform";
import { logAuditEvent } from "~/lib/audit";

export interface PlatformOverrideState {
  status: "idle" | "ok" | "error";
  message?: string;
}

type TenantStatus = "trialing" | "active" | "past_due" | "canceled";

const ALLOWED_STATUSES: TenantStatus[] = [
  "trialing",
  "active",
  "past_due",
  "canceled",
];

/** Force a tenant's billing status to a specific value, bypassing Stripe.
 *  Intended for: local dev (no Stripe loop), comp accounts, webhook misses.
 *  Writes a platform.tenant.status_overridden audit event with before/after
 *  so a Stripe-driven update later doesn't silently undo the override
 *  without a trail. */
export async function forceTenantStatusAction(
  _prev: PlatformOverrideState,
  formData: FormData,
): Promise<PlatformOverrideState> {
  const actor = await requirePlatformAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const next = String(formData.get("status") ?? "") as TenantStatus;
  if (!tenantId) return { status: "error", message: "Missing tenant id." };
  if (!ALLOWED_STATUSES.includes(next)) {
    return { status: "error", message: `Status '${next}' is not allowed.` };
  }

  const [before] = await db
    .select({ status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!before) return { status: "error", message: "Tenant not found." };

  await db
    .update(tenants)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await logAuditEvent({
    tenantId,
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: "platform.tenant.status_overridden",
    targetKind: "tenant",
    targetId: tenantId,
    details: { from: before.status, to: next },
  });

  revalidatePath(`/platform/tenants/${tenantId}`);
  return {
    status: "ok",
    message: `Status set to ${next} (was ${before.status}).`,
  };
}

/** Push the trial out by N days from now (default 30). Useful when a paid
 *  subscription is in flight and you want to keep the tenant unblocked
 *  until the webhook lands, or as a goodwill extension. */
export async function extendTenantTrialAction(
  _prev: PlatformOverrideState,
  formData: FormData,
): Promise<PlatformOverrideState> {
  const actor = await requirePlatformAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const daysRaw = Number(formData.get("days") ?? 30);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, daysRaw)) : 30;
  if (!tenantId) return { status: "error", message: "Missing tenant id." };

  const [before] = await db
    .select({ trialEndsAt: tenants.trialEndsAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!before) return { status: "error", message: "Tenant not found." };

  const nextEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await db
    .update(tenants)
    .set({ trialEndsAt: nextEnd, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await logAuditEvent({
    tenantId,
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: "platform.tenant.trial_extended",
    targetKind: "tenant",
    targetId: tenantId,
    details: {
      from: before.trialEndsAt?.toISOString() ?? null,
      to: nextEnd.toISOString(),
      days,
    },
  });

  revalidatePath(`/platform/tenants/${tenantId}`);
  return {
    status: "ok",
    message: `Trial extended to ${nextEnd.toISOString().slice(0, 10)} (+${days}d).`,
  };
}
