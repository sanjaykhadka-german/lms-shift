"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scEmployees,
  scLeaveTypes,
  scXeroEarningsMapping,
  scXeroEmployeeLinks,
  scXeroLeaveMapping,
  type ScPayrollCategory,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAdmin as isOwnerLevel } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  buildConsentUrl,
  deleteConnection,
  isXeroConfigured,
  listAvailableOrgs,
  listEarningsRates,
  listLeaveTypes,
  listXeroEmployees,
  setActiveOrg,
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

// ─── Switch active Xero org (multi-org chooser) ─────────────────────
//
// One consent can authorise several Xero orgs. We persist a single
// active org per workspace; this lets the owner re-point it without
// disconnecting + reconnecting. Validated against the orgs the stored
// token can actually reach so a stale/forged id can't be set.

const switchOrgSchema = z.object({
  xeroTenantId: z.string().min(1).max(100),
});

export async function switchXeroOrgAction(formData: FormData): Promise<void> {
  const parsed = switchOrgSchema.safeParse({
    xeroTenantId: formData.get("xeroTenantId"),
  });
  if (!parsed.success) return;
  const membership = await requireOwner();
  const tenantId = membership.tenant.id;

  const orgs = await listAvailableOrgs(tenantId);
  const match = orgs.find((o) => o.xeroTenantId === parsed.data.xeroTenantId);
  if (!match) return; // org not reachable by this token — ignore

  await setActiveOrg(tenantId, match.xeroTenantId, match.xeroTenantName);
  await logAuditEvent({
    action: "shiftcraft.xero.org_switched",
    targetKind: "sc_xero_connection",
    details: { xeroTenantId: match.xeroTenantId },
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

// ─── Auto-matching (Deputy-style) ───────────────────────────────────
//
// Two one-click passes that fill in the obvious mappings/links and leave
// only the exceptions for the human:
//   - earnings: match each unmapped award category to a Xero earnings rate
//     by name, but ONLY when the match is unambiguous (exactly one rate fits
//     the category's keyword shape) so payroll never silently mis-maps.
//   - employees: link each unlinked employee to the Xero employee with the
//     same email (the only reliable cross-system key).

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// True when a Xero earnings-rate name fits the given payroll category. Kept
// deliberately strict: OT categories require an "overtime" token, the base
// (non-OT) variants exclude it, so e.g. "Saturday" and "Saturday Overtime"
// don't both grab penalty_sat.
function rateFitsCategory(category: ScPayrollCategory, rateName: string): boolean {
  const n = norm(rateName);
  const ot = n.includes("overtime") || n.includes("over time");
  const sat = n.includes("saturday");
  const sun = n.includes("sunday");
  const ph = n.includes("public holiday") || n.includes("holiday");
  const night = n.includes("night");
  switch (category) {
    case "ordinary":
      return n.includes("ordinary") && !ot;
    case "overtime":
      return ot && !sat && !sun && !ph && !night;
    case "penalty_sat":
      return sat && !ot;
    case "penalty_sat_ot":
      return sat && ot;
    case "penalty_sun":
      return sun && !ot;
    case "penalty_sun_ot":
      return sun && ot;
    case "penalty_ph":
      return ph && !ot;
    case "penalty_ph_ot":
      return ph && ot;
    case "penalty_night":
      return night;
    case "allowance":
      return n.includes("allowance");
    default:
      return false;
  }
}

export async function autoMapEarningsAction(): Promise<void> {
  const membership = await requireOwner();
  const tenantId = membership.tenant.id;

  const rates = await listEarningsRates(tenantId);
  const existing = await forTenant(tenantId).run((tx) =>
    tx
      .select({ category: scXeroEarningsMapping.category })
      .from(scXeroEarningsMapping)
      .where(eq(scXeroEarningsMapping.traceyTenantId, tenantId)),
  );
  const alreadyMapped = new Set(existing.map((e) => e.category));

  let mapped = 0;
  let ambiguous = 0;
  for (const category of PAYROLL_CATEGORIES) {
    if (alreadyMapped.has(category)) continue;
    const fits = rates.filter((r) => rateFitsCategory(category, r.name));
    if (fits.length === 0) continue;
    if (fits.length > 1) {
      // More than one plausible rate — don't guess; leave for the human.
      ambiguous += 1;
      continue;
    }
    const rate = fits[0]!;
    await forTenant(tenantId).run((tx) =>
      tx
        .insert(scXeroEarningsMapping)
        .values({
          traceyTenantId: tenantId,
          category,
          xeroEarningsRateId: rate.id,
          xeroEarningsRateName: rate.name,
        })
        .onConflictDoUpdate({
          target: [
            scXeroEarningsMapping.traceyTenantId,
            scXeroEarningsMapping.category,
          ],
          set: {
            xeroEarningsRateId: rate.id,
            xeroEarningsRateName: rate.name,
            updatedAt: new Date(),
          },
        }),
    );
    mapped += 1;
  }

  await logAuditEvent({
    action: "shiftcraft.xero.earnings_auto_mapped",
    targetKind: "sc_xero_earnings_mapping",
    details: { mapped, ambiguous },
  });
  revalidatePath("/app/admin/payroll");
  redirect(`/app/admin/payroll?automapped=${mapped}&ambiguous=${ambiguous}`);
}

// ─── Leave-type mapping (Slice 2) ───────────────────────────────────

const leaveMappingSchema = z.object({
  scLeaveTypeId: z.string().uuid(),
  xeroLeaveTypeId: z.string().max(200),
  xeroLeaveTypeName: z.string().max(200).optional().or(z.literal("")),
});

export async function saveLeaveMappingAction(formData: FormData): Promise<void> {
  const parsed = leaveMappingSchema.safeParse({
    scLeaveTypeId: formData.get("scLeaveTypeId"),
    xeroLeaveTypeId: formData.get("xeroLeaveTypeId") ?? "",
    xeroLeaveTypeName: formData.get("xeroLeaveTypeName") ?? "",
  });
  if (!parsed.success) return;
  const membership = await requireOwner();
  const tenantId = membership.tenant.id;

  // Empty xeroLeaveTypeId clears the mapping (the form's "—" option).
  if (!parsed.data.xeroLeaveTypeId) {
    await forTenant(tenantId).run((tx) =>
      tx
        .delete(scXeroLeaveMapping)
        .where(
          and(
            eq(scXeroLeaveMapping.traceyTenantId, tenantId),
            eq(scXeroLeaveMapping.scLeaveTypeId, parsed.data.scLeaveTypeId),
          ),
        ),
    );
    revalidatePath("/app/admin/payroll");
    return;
  }

  const name = parsed.data.xeroLeaveTypeName?.length
    ? parsed.data.xeroLeaveTypeName
    : null;

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scXeroLeaveMapping)
      .values({
        traceyTenantId: tenantId,
        scLeaveTypeId: parsed.data.scLeaveTypeId,
        xeroLeaveTypeId: parsed.data.xeroLeaveTypeId,
        xeroLeaveTypeName: name,
      })
      .onConflictDoUpdate({
        target: [
          scXeroLeaveMapping.traceyTenantId,
          scXeroLeaveMapping.scLeaveTypeId,
        ],
        set: {
          xeroLeaveTypeId: parsed.data.xeroLeaveTypeId,
          xeroLeaveTypeName: name,
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.xero.leave_mapping_saved",
    targetKind: "sc_xero_leave_mapping",
    details: {
      scLeaveTypeId: parsed.data.scLeaveTypeId,
      xeroLeaveTypeId: parsed.data.xeroLeaveTypeId,
    },
  });
  revalidatePath("/app/admin/payroll");
}

// Two leave types "fit" when their normalised names are equal, or one contains
// the other (e.g. ShiftCraft "Annual" ↔ Xero "Annual Leave"). Maps only when
// exactly one Xero type fits — ambiguous matches are left for the human.
export async function autoMapLeaveAction(): Promise<void> {
  const membership = await requireOwner();
  const tenantId = membership.tenant.id;

  const xeroTypes = await listLeaveTypes(tenantId);
  const [leaveTypes, existing] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scLeaveTypes.id, name: scLeaveTypes.name })
        .from(scLeaveTypes)
        .where(
          and(
            eq(scLeaveTypes.traceyTenantId, tenantId),
            eq(scLeaveTypes.isArchived, false),
          ),
        ),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ scLeaveTypeId: scXeroLeaveMapping.scLeaveTypeId })
        .from(scXeroLeaveMapping)
        .where(eq(scXeroLeaveMapping.traceyTenantId, tenantId)),
    ),
  ]);
  const alreadyMapped = new Set(existing.map((e) => e.scLeaveTypeId));

  let mapped = 0;
  let ambiguous = 0;
  for (const lt of leaveTypes) {
    if (alreadyMapped.has(lt.id)) continue;
    const n = norm(lt.name);
    const fits = xeroTypes.filter((x) => {
      const xn = norm(x.name);
      return xn === n || xn.includes(n) || n.includes(xn);
    });
    if (fits.length === 0) continue;
    if (fits.length > 1) {
      ambiguous += 1;
      continue;
    }
    const x = fits[0]!;
    await forTenant(tenantId).run((tx) =>
      tx
        .insert(scXeroLeaveMapping)
        .values({
          traceyTenantId: tenantId,
          scLeaveTypeId: lt.id,
          xeroLeaveTypeId: x.id,
          xeroLeaveTypeName: x.name,
        })
        .onConflictDoUpdate({
          target: [
            scXeroLeaveMapping.traceyTenantId,
            scXeroLeaveMapping.scLeaveTypeId,
          ],
          set: {
            xeroLeaveTypeId: x.id,
            xeroLeaveTypeName: x.name,
            updatedAt: new Date(),
          },
        }),
    );
    mapped += 1;
  }

  await logAuditEvent({
    action: "shiftcraft.xero.leave_auto_mapped",
    targetKind: "sc_xero_leave_mapping",
    details: { mapped, ambiguous },
  });
  revalidatePath("/app/admin/payroll");
  redirect(
    `/app/admin/payroll?leavemapped=${mapped}&leaveambiguous=${ambiguous}`,
  );
}

export async function autoLinkEmployeesAction(): Promise<void> {
  const membership = await requireOwner();
  const tenantId = membership.tenant.id;

  const [xeroEmps, scEmps, existing] = await Promise.all([
    listXeroEmployees(tenantId),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scEmployees.id, email: scEmployees.email })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            eq(scEmployees.isActive, true),
          ),
        ),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ scEmployeeId: scXeroEmployeeLinks.scEmployeeId })
        .from(scXeroEmployeeLinks)
        .where(eq(scXeroEmployeeLinks.traceyTenantId, tenantId)),
    ),
  ]);

  const alreadyLinked = new Set(existing.map((e) => e.scEmployeeId));
  const xeroByEmail = new Map<string, (typeof xeroEmps)[number]>();
  for (const x of xeroEmps) {
    if (x.email) xeroByEmail.set(x.email.toLowerCase(), x);
  }

  let linked = 0;
  let noMatch = 0;
  for (const e of scEmps) {
    if (alreadyLinked.has(e.id)) continue;
    if (!e.email) continue;
    const x = xeroByEmail.get(e.email.toLowerCase());
    if (!x) {
      noMatch += 1;
      continue;
    }
    const name = `${x.firstName} ${x.lastName}`.trim() || null;
    try {
      await forTenant(tenantId).run((tx) =>
        tx
          .insert(scXeroEmployeeLinks)
          .values({
            traceyTenantId: tenantId,
            scEmployeeId: e.id,
            xeroEmployeeId: x.id,
            xeroEmployeeName: name,
          })
          .onConflictDoUpdate({
            target: [
              scXeroEmployeeLinks.traceyTenantId,
              scXeroEmployeeLinks.scEmployeeId,
            ],
            set: { xeroEmployeeId: x.id, xeroEmployeeName: name },
          }),
      );
      linked += 1;
    } catch (err) {
      // Same Xero employee already linked to another sc employee — skip,
      // matching linkEmployeeAction's unique-constraint handling.
      if (
        err instanceof Error &&
        err.message.includes("sc_xero_employee_links_xero_uq")
      ) {
        continue;
      }
      throw err;
    }
  }

  await logAuditEvent({
    action: "shiftcraft.xero.employees_auto_linked",
    targetKind: "sc_xero_employee_link",
    details: { linked, noMatch },
  });
  revalidatePath("/app/admin/payroll");
  redirect(`/app/admin/payroll?autolinked=${linked}&nomatch=${noMatch}`);
}
