"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  db,
  tenants,
  members,
  tenantSubscriptions,
  provisionTenantFull,
  type Tenant,
} from "@tracey/db";
import { requireUser, setActiveTenant } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";

// New ShiftCraft workspaces start a 14-day trial (matches the marketing page
// + the LMS trial length). The chosen plan from the pricing page is recorded
// on the row so /app/billing can pre-select it at subscribe time.
const TRIAL_DAYS = 14;

const schema = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(100),
  plan: z.enum(["free", "starter", "pro", "enterprise"]).optional(),
});

export type CreateTenantState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    name: formData.get("name"),
    plan: formData.get("plan") ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { name } = parsed.data;
  // Default a paid intent to "starter"; enterprise/free fall back to starter
  // for the trial (enterprise is contact-sales, not a self-serve plan).
  const trialPlan =
    parsed.data.plan === "pro" ? "pro" : "starter";

  let created: Tenant | undefined;
  // Slug is unique-indexed (tenants_slug_uq). Two people from the same
  // company often type variants of the same workspace name; we silently
  // suffix on collision rather than rejecting their submission. After 3
  // attempts something is genuinely wrong, so surface the error.
  const baseSlug = slugify(name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomBytes(2).toString("hex")}`;
    try {
      [created] = await db
        .insert(tenants)
        .values({ ownerUserId: user.id, name, slug })
        .returning();
      break;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  if (!created) {
    return { status: "error", message: "Failed to create workspace. Please try again." };
  }

  // Provision the per-tenant schema BEFORE attaching the membership.
  //
  // Unlike lms-web's onboarding (which gates on PER_TENANT_SCHEMA_ENABLED
  // and can fall through to public.*), a standalone ShiftCraft workspace
  // MUST have its own schema with the full sc_* surface — every ShiftCraft
  // page queries those tables. provisionTenantFull applies the LMS baseline
  // + all sc_* per-tenant migrations; it's idempotent and resumable.
  //
  // Ordering: if provisioning fails, no `members` row exists yet, so the
  // user simply sees the onboarding form again (rather than being trapped
  // redirecting to a broken /app). The half-provisioned tenant row is
  // orphaned and harmless — an operator can finish it with
  // `pnpm db:migrate-tenants` or remove it.
  try {
    await provisionTenantFull(db, created.id);
  } catch (err) {
    console.error(`[onboarding] provisionTenantFull failed for ${created.id}:`, err);
    return {
      status: "error",
      message:
        "We couldn't finish setting up your workspace. Please try again, or contact support if it keeps happening.",
    };
  }

  await db.insert(members).values({
    tenantId: created.id,
    userId: user.id,
    role: "owner",
  });

  // Provision the ShiftCraft entitlement: a trialing subscription row that the
  // /app entitlement gate reads. Without this the tenant would be "blocked"
  // once SHIFTCRAFT_BILLING_ENFORCED is on. Idempotent on (tenant_id, app).
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  await db
    .insert(tenantSubscriptions)
    .values({
      tenantId: created.id,
      app: "shiftcraft",
      plan: trialPlan,
      status: "trialing",
      trialEndsAt,
    })
    .onConflictDoNothing({
      target: [tenantSubscriptions.tenantId, tenantSubscriptions.app],
    });

  // Set the active-tenant cookie first so the audit row (which derives its
  // tenant from currentMembership()) is attributed to the new workspace.
  await setActiveTenant(created.id);

  await logAuditEvent({
    action: "tenant.created",
    targetKind: "tenant",
    targetId: created.id,
    details: { name: created.name, slug: created.slug },
  });

  redirect("/app");
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || `workspace-${randomBytes(3).toString("hex")}`;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}
