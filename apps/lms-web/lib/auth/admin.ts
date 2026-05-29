import "server-only";
import { redirect } from "next/navigation";
import { forTenant } from "@tracey/db";
import { requireTenant } from "./current";
import { getOrProvisionLmsUser, type LearnerContext } from "~/lib/lms/learner";
import { isEffectivelyActive } from "~/lib/lms/employee-status";
import { assertWriteAccess } from "~/lib/billing/guard";

/**
 * Admin gate for /app/admin/*. Requires the active tenant membership to be
 * `owner` or `admin`. `member` is bounced back to /app.
 *
 * Returns the Tracey user/tenant + the linked Flask `users` row (provisioned
 * if it doesn't exist yet — same logic as /sso/callback). Admin pages always
 * need both: the Tracey side for audit attribution, the Flask side for the
 * domain queries.
 */
export async function requireAdmin(): Promise<LearnerContext & { role: "owner" | "admin" }> {
  const { tenant, role } = await requireTenant();
  if (role !== "owner" && role !== "admin") {
    redirect("/app");
  }
  // Lazy import avoids a circular dep — learner.ts imports from current.ts.
  const { requireUser } = await import("./current");
  const user = await requireUser();
  const lmsUser = await getOrProvisionLmsUser({
    traceyUserId: user.id,
    traceyTenantId: tenant.id,
    email: user.email,
    name: user.name,
  });
  // Mirror the requireLearner gate: deactivated/terminated employees lose
  // admin access too, not just learner pages.
  if (!isEffectivelyActive(lmsUser)) {
    redirect("/sign-in?reason=deactivated");
  }
  return {
    traceyUserId: user.id,
    traceyTenantId: tenant.id,
    tenantTimezone: tenant.timezone,
    tenantAuditMode: tenant.auditMode,
    tenantAuditSettings: tenant.auditModeSettings,
    lmsUser,
    role,
    db: forTenant(tenant.id),
  };
}

/**
 * Stricter variant for **mutating** admin server actions. Same as
 * `requireAdmin()` plus a billing-gate check: tenants in `read_only` or
 * `blocked` access state can't write. Throws `BillingGateError`.
 *
 * Pages that only render data should keep using `requireAdmin()` so a
 * read-only tenant can still see (but not edit) their workspace.
 */
export async function requireAdminAction(): Promise<LearnerContext & { role: "owner" | "admin" }> {
  await assertWriteAccess();
  return requireAdmin();
}
