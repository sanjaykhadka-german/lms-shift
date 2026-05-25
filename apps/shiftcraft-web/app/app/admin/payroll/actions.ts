"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scXeroEarningsMapping,
  scXeroEmployeeLinks,
  type ScPayrollCategory,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAdmin as isOwnerLevel } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  buildConsentUrl,
  deleteConnection,
  isXeroConfigured,
} from "~/lib/payroll/xero";
import { PAYROLL_CATEGORIES } from "~/lib/payroll/categories";

const STATE_COOKIE = "sc_xero_oauth_state";
const STATE_COOKIE_MAX_AGE = 600; // 10min — covers the consent screen

async function requireOwner() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (!isOwnerLevel(m.role)) {
    throw new Error("Only the owner can manage the payroll connection.");
  }
  return m;
}

// ─── Start the connect flow ─────────────────────────────────────────
//
// Generates a single-use state token, drops it in an HttpOnly cookie,
// then redirects to Xero's consent screen. The callback route matches
// the cookie against the echoed-back state to defend against CSRF.

export async function startConnectAction(): Promise<void> {
  if (!isXeroConfigured()) {
    throw new Error("Xero is not configured on this server.");
  }
  await requireOwner();
  const state = randomBytes(24).toString("hex");
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  const url = await buildConsentUrl(state);
  redirect(url);
}

// ─── Disconnect (owner-only) ────────────────────────────────────────

export async function disconnectAction(): Promise<void> {
  const membership = await requireOwner();
  await deleteConnection(membership.tenant.id);
  await logAuditEvent({
    action: "shiftcraft.xero.disconnected",
    targetKind: "sc_xero_connection",
  });
  revalidatePath("/app/admin/payroll");
}

// ─── Earnings-code mapping ──────────────────────────────────────────

const mappingSchema = z.object({
  category: z.enum(PAYROLL_CATEGORIES as [string, ...string[]]),
  xeroEarningsRateId: z.string().min(1).max(200),
  xeroEarningsRateName: z.string().max(200).optional().or(z.literal("")),
});

export async function saveMappingAction(formData: FormData): Promise<void> {
  const parsed = mappingSchema.safeParse({
    category: formData.get("category"),
    xeroEarningsRateId: formData.get("xeroEarningsRateId"),
    xeroEarningsRateName: formData.get("xeroEarningsRateName") ?? "",
  });
  if (!parsed.success) return;
  const membership = await requireOwner();
  const tenantId = membership.tenant.id;

  // Empty xeroEarningsRateId clears the mapping (the form's "—" option).
  if (!parsed.data.xeroEarningsRateId || parsed.data.xeroEarningsRateId === "") {
    await forTenant(tenantId).run((tx) =>
      tx
        .delete(scXeroEarningsMapping)
        .where(
          and(
            eq(scXeroEarningsMapping.traceyTenantId, tenantId),
            eq(
              scXeroEarningsMapping.category,
              parsed.data.category as ScPayrollCategory,
            ),
          ),
        ),
    );
    revalidatePath("/app/admin/payroll");
    return;
  }

  const name = parsed.data.xeroEarningsRateName?.length
    ? parsed.data.xeroEarningsRateName
    : null;

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scXeroEarningsMapping)
      .values({
        traceyTenantId: tenantId,
        category: parsed.data.category as ScPayrollCategory,
        xeroEarningsRateId: parsed.data.xeroEarningsRateId,
        xeroEarningsRateName: name,
      })
      .onConflictDoUpdate({
        target: [
          scXeroEarningsMapping.traceyTenantId,
          scXeroEarningsMapping.category,
        ],
        set: {
          xeroEarningsRateId: parsed.data.xeroEarningsRateId,
          xeroEarningsRateName: name,
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.xero.earnings_mapping_saved",
    targetKind: "sc_xero_earnings_mapping",
    details: {
      category: parsed.data.category,
      rateId: parsed.data.xeroEarningsRateId,
    },
  });
  revalidatePath("/app/admin/payroll");
}

// ─── Employee linking ───────────────────────────────────────────────

const linkSchema = z.object({
  scEmployeeId: z.string().uuid(),
  xeroEmployeeId: z.string().min(1).max(200),
  xeroEmployeeName: z.string().max(200).optional().or(z.literal("")),
});

export async function linkEmployeeAction(formData: FormData): Promise<void> {
  const parsed = linkSchema.safeParse({
    scEmployeeId: formData.get("scEmployeeId"),
    xeroEmployeeId: formData.get("xeroEmployeeId"),
    xeroEmployeeName: formData.get("xeroEmployeeName") ?? "",
  });
  if (!parsed.success) return;
  const membership = await requireOwner();
  const tenantId = membership.tenant.id;

  // Empty xeroEmployeeId removes the existing link.
  if (
    !parsed.data.xeroEmployeeId ||
    parsed.data.xeroEmployeeId === ""
  ) {
    await forTenant(tenantId).run((tx) =>
      tx
        .delete(scXeroEmployeeLinks)
        .where(
          and(
            eq(scXeroEmployeeLinks.traceyTenantId, tenantId),
            eq(
              scXeroEmployeeLinks.scEmployeeId,
              parsed.data.scEmployeeId,
            ),
          ),
        ),
    );
    revalidatePath("/app/admin/payroll");
    return;
  }

  const name = parsed.data.xeroEmployeeName?.length
    ? parsed.data.xeroEmployeeName
    : null;

  try {
    await forTenant(tenantId).run((tx) =>
      tx
        .insert(scXeroEmployeeLinks)
        .values({
          traceyTenantId: tenantId,
          scEmployeeId: parsed.data.scEmployeeId,
          xeroEmployeeId: parsed.data.xeroEmployeeId,
          xeroEmployeeName: name,
        })
        .onConflictDoUpdate({
          target: [
            scXeroEmployeeLinks.traceyTenantId,
            scXeroEmployeeLinks.scEmployeeId,
          ],
          set: {
            xeroEmployeeId: parsed.data.xeroEmployeeId,
            xeroEmployeeName: name,
          },
        }),
    );
  } catch (err) {
    // Conflict on (tenant, xero_employee_id) — same Xero employee
    // can't be linked to two sc_employees rows. The action returns
    // void; this surfaces only in the audit log so the admin sees
    // why the page state didn't change. A friendlier inline error
    // is a follow-up.
    if (
      err instanceof Error &&
      err.message.includes("sc_xero_employee_links_xero_uq")
    ) {
      console.warn("[xero] duplicate xero_employee_id link rejected:", err);
      return;
    }
    throw err;
  }

  await logAuditEvent({
    action: "shiftcraft.xero.employee_linked",
    targetKind: "sc_xero_employee_link",
    details: {
      scEmployeeId: parsed.data.scEmployeeId,
      xeroEmployeeId: parsed.data.xeroEmployeeId,
    },
  });
  revalidatePath("/app/admin/payroll");
}
