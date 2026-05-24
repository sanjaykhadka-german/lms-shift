"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  forTenant,
  members,
  scDepartments,
  scEmployeePins,
  scEmployees,
  users,
  type Role,
} from "@tracey/db";
import { decryptPii, encryptPii } from "@tracey/db/pii";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { hashPassword, verifyPassword } from "~/lib/auth/passwords";
import { logAuditEvent } from "~/lib/audit";
import { notifyTenantAdmins } from "~/lib/notifications";
import { isAtLeastManager } from "~/lib/roles";

type TenantTx = Parameters<
  Parameters<ReturnType<typeof forTenant>["run"]>[0]
>[0];

/**
 * Resolve a department by name within a tenant, creating it if needed.
 * Case-insensitive lookup via the partial unique index on
 * (tracey_tenant_id, lower(name)). Returns null when `name` is blank.
 *
 * Runs inside the caller's forTenant() transaction context — the
 * search_path is already set so unqualified sc_departments resolves
 * correctly.
 */
async function resolveDepartmentId(
  tx: TenantTx,
  tenantId: string,
  rawName: string | null,
): Promise<string | null> {
  if (!rawName) return null;
  const name = rawName.trim();
  if (name.length === 0) return null;
  const existing = await tx
    .select({ id: scDepartments.id })
    .from(scDepartments)
    .where(
      and(
        eq(scDepartments.traceyTenantId, tenantId),
        sql`lower(${scDepartments.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await tx
    .insert(scDepartments)
    .values({ traceyTenantId: tenantId, name })
    .returning({ id: scDepartments.id });
  return inserted[0]?.id ?? null;
}

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Weekday = (typeof WEEKDAYS)[number];

const employeeSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(120, "Too long"),
  email: z
    .union([z.literal(""), z.string().trim().email("Invalid email")])
    .optional(),
  mobile: z.string().trim().max(40).optional().or(z.literal("")),
  department: z.string().trim().max(80).optional().or(z.literal("")),
  employmentType: z.enum(["permanent", "casual", "labour_hire"]),
  hourlyRate: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(/^\d{1,7}(\.\d{1,2})?$/, "Rate must look like 24.50"),
    ])
    .optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  // Personal details surfaced by the People > Team detail modal.
  preferredName: z.string().trim().max(120).optional().or(z.literal("")),
  gender: z
    .union([
      z.literal(""),
      z.enum(["female", "male", "non_binary", "prefer_not_to_say"]),
    ])
    .optional(),
  dateOfBirth: z
    .union([
      z.literal(""),
      z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    ])
    .optional(),
  addressLine: z.string().trim().max(300).optional().or(z.literal("")),
  emergencyContactName: z.string().trim().max(120).optional().or(z.literal("")),
  emergencyContactPhone: z.string().trim().max(40).optional().or(z.literal("")),
});

function collectAvailability(formData: FormData): Record<Weekday, string> | null {
  const out: Record<string, string> = {};
  let anyPresent = false;
  for (const day of WEEKDAYS) {
    const raw = String(formData.get(`availability_${day}`) ?? "").trim();
    if (raw.length > 0) {
      out[day] = raw;
      anyPresent = true;
    }
  }
  return anyPresent ? (out as Record<Weekday, string>) : null;
}

function emptyToNull(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Find the `app.users.id` whose email matches `email` AND is a member of
 * `tenantId`. Returns null if no match. The list-page row dedupe uses the
 * same case-insensitive email match — this puts the link in the DB column
 * so the edit page's PIN / Role cards (gated on `app_user_id IS NOT NULL`)
 * actually render. Lookup hits the shared `app` schema, not per-tenant.
 */
async function findAppUserIdByTenantEmail(
  tenantId: string,
  email: string,
): Promise<string | null> {
  const matches = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(members, eq(members.userId, users.id))
    .where(
      and(
        eq(members.tenantId, tenantId),
        sql`lower(${users.email}) = lower(${email})`,
      ),
    )
    .limit(1);
  return matches[0]?.userId ?? null;
}

export async function createEmployeeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = employeeSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email") ?? "",
    mobile: formData.get("mobile") ?? "",
    department: formData.get("department") ?? "",
    employmentType: formData.get("employmentType") ?? "permanent",
    hourlyRate: formData.get("hourlyRate") ?? "",
    notes: formData.get("notes") ?? "",
    preferredName: formData.get("preferredName") ?? "",
    gender: formData.get("gender") ?? "",
    dateOfBirth: formData.get("dateOfBirth") ?? "",
    addressLine: formData.get("addressLine") ?? "",
    emergencyContactName: formData.get("emergencyContactName") ?? "",
    emergencyContactPhone: formData.get("emergencyContactPhone") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await currentMembership();
  if (!membership) {
    return {
      status: "error",
      message: "You must belong to a workspace to add employees.",
    };
  }
  const tenantId = membership.tenant.id;
  const me = await currentUser();

  const email = emptyToNull(parsed.data.email);
  const mobile = emptyToNull(parsed.data.mobile);
  const department = emptyToNull(parsed.data.department);
  const notes = emptyToNull(parsed.data.notes);
  const availability = collectAvailability(formData);

  // Pre-check email uniqueness inside the tenant — the partial unique index
  // is the source of truth, but surfacing this as a field error beats a
  // generic 500.
  if (email) {
    const existing = await forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scEmployees.id })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            sql`lower(${scEmployees.email}) = lower(${email})`,
          ),
        )
        .limit(1),
    );
    if (existing.length > 0) {
      return {
        status: "error",
        message: "Please fix the highlighted fields.",
        fieldErrors: { email: ["An employee with this email already exists."] },
      };
    }
  }

  const hourlyRate = emptyToNull(parsed.data.hourlyRate);

  // Auto-link to the matching auth user if this email already belongs to
  // a member of this tenant. Without this, the row creates with
  // app_user_id=NULL and the edit page's PIN / Role cards never render.
  const linkedAppUserId = email
    ? await findAppUserIdByTenantEmail(tenantId, email)
    : null;

  try {
    await forTenant(tenantId).run(async (tx) => {
      const departmentId = await resolveDepartmentId(tx, tenantId, department);
      await tx.insert(scEmployees).values({
        traceyTenantId: tenantId,
        fullName: parsed.data.fullName,
        email,
        mobile,
        departmentId,
        availability,
        employmentType: parsed.data.employmentType,
        hourlyRate,
        notes,
        appUserId: linkedAppUserId,
        createdByUserId: me?.id ?? null,
        preferredName: emptyToNull(parsed.data.preferredName),
        gender: emptyToNull(parsed.data.gender),
        dateOfBirth: emptyToNull(parsed.data.dateOfBirth),
        addressLine: emptyToNull(parsed.data.addressLine),
        emergencyContactName: emptyToNull(parsed.data.emergencyContactName),
        emergencyContactPhone: emptyToNull(parsed.data.emergencyContactPhone),
      });
    });
  } catch (err) {
    // Catches the rare race against the unique index (two creates same email
    // submitted simultaneously). Postgres throws SQLSTATE 23505.
    const msg = (err as { code?: string; message?: string })?.message ?? "";
    if (msg.includes("sc_employees_tenant_email_uq")) {
      return {
        status: "error",
        message: "Please fix the highlighted fields.",
        fieldErrors: { email: ["An employee with this email already exists."] },
      };
    }
    throw err;
  }

  // Suggest-as-learner notification: only when there's an email to invite on
  // (the LMS uses email as the learner identity key) AND the person is a
  // staff member who would normally need training. Labour-hire is skipped
  // by design — they're not part of the training cohort.
  if (email && parsed.data.employmentType !== "labour_hire") {
    await notifyTenantAdmins(
      tenantId,
      {
        kind: "shiftcraft_employee_added",
        title: "New ShiftCraft employee — add to training?",
        body: `${parsed.data.fullName} (${email}) was just added in ShiftCraft. Click to add them to the LMS so training can be assigned.`,
        actionUrl: "/app/admin/employees",
      },
      { excludeUserId: me?.id ?? undefined },
    );
  }

  revalidatePath("/app/employees");
  redirect("/app/employees?added=1");
}

export async function updateEmployeeAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = employeeSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email") ?? "",
    mobile: formData.get("mobile") ?? "",
    department: formData.get("department") ?? "",
    employmentType: formData.get("employmentType") ?? "permanent",
    hourlyRate: formData.get("hourlyRate") ?? "",
    notes: formData.get("notes") ?? "",
    preferredName: formData.get("preferredName") ?? "",
    gender: formData.get("gender") ?? "",
    dateOfBirth: formData.get("dateOfBirth") ?? "",
    addressLine: formData.get("addressLine") ?? "",
    emergencyContactName: formData.get("emergencyContactName") ?? "",
    emergencyContactPhone: formData.get("emergencyContactPhone") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await currentMembership();
  if (!membership) {
    return {
      status: "error",
      message: "You must belong to a workspace to edit employees.",
    };
  }
  const tenantId = membership.tenant.id;

  const email = emptyToNull(parsed.data.email);
  const mobile = emptyToNull(parsed.data.mobile);
  const department = emptyToNull(parsed.data.department);
  const notes = emptyToNull(parsed.data.notes);
  const availability = collectAvailability(formData);
  const hourlyRate = emptyToNull(parsed.data.hourlyRate);

  // Email-uniqueness precheck excludes this row.
  if (email) {
    const existing = await forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scEmployees.id })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            sql`lower(${scEmployees.email}) = lower(${email})`,
            sql`${scEmployees.id} <> ${id}`,
          ),
        )
        .limit(1),
    );
    if (existing.length > 0) {
      return {
        status: "error",
        message: "Please fix the highlighted fields.",
        fieldErrors: { email: ["Another employee already uses this email."] },
      };
    }
  }

  // If the row is currently unlinked AND the saved email maps to an
  // existing tenant member, attach the auth user. Never overwrite an
  // existing link — that would silently move a row's PIN / role binding
  // to a different person when an admin edits an email.
  const [existingRow] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ appUserId: scEmployees.appUserId })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.id, id),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  const shouldLink = !existingRow?.appUserId && email !== null;
  const linkedAppUserId = shouldLink
    ? await findAppUserIdByTenantEmail(tenantId, email!)
    : null;

  try {
    await forTenant(tenantId).run(async (tx) => {
      const departmentId = await resolveDepartmentId(tx, tenantId, department);
      const updateSet: Partial<typeof scEmployees.$inferInsert> = {
        fullName: parsed.data.fullName,
        email,
        mobile,
        departmentId,
        availability,
        employmentType: parsed.data.employmentType,
        hourlyRate,
        notes,
        preferredName: emptyToNull(parsed.data.preferredName),
        gender: emptyToNull(parsed.data.gender),
        dateOfBirth: emptyToNull(parsed.data.dateOfBirth),
        addressLine: emptyToNull(parsed.data.addressLine),
        emergencyContactName: emptyToNull(parsed.data.emergencyContactName),
        emergencyContactPhone: emptyToNull(parsed.data.emergencyContactPhone),
        updatedAt: new Date(),
      };
      if (linkedAppUserId !== null) {
        updateSet.appUserId = linkedAppUserId;
      }
      await tx
        .update(scEmployees)
        .set(updateSet)
        .where(
          and(
            eq(scEmployees.id, id),
            eq(scEmployees.traceyTenantId, tenantId),
          ),
        );
    });
  } catch (err) {
    const msg = (err as { code?: string; message?: string })?.message ?? "";
    if (msg.includes("sc_employees_tenant_email_uq")) {
      return {
        status: "error",
        message: "Please fix the highlighted fields.",
        fieldErrors: { email: ["Another employee already uses this email."] },
      };
    }
    throw err;
  }

  revalidatePath("/app/employees");
  revalidatePath(`/app/employees/${id}/edit`);
  return { status: "ok", message: "Saved." };
}

// ─── Kiosk PIN management ───
//
// Sets or rotates the 4-digit PIN an employee uses to authenticate at the
// on-premise kiosk. Stored as a bcrypt-12 hash in sc_employee_pins, keyed
// on (tenant, app_user_id). One PIN per (tenant, user); resetting overwrites.
//
// Authorization: Manager+ (Tracey `admin` or `owner`). Employees cannot set
// their own PIN — the kiosk surface is operator-managed.
//
// Anchored on app_user_id (the auth identity) rather than sc_employees.id
// because clock events are keyed on the same identifier. Labour-hire roster
// rows without an attached auth user can't have a PIN — the UI hides the
// card in that case.

export type PinFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

const pinSchema = z
  .object({
    pin: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "PIN must be exactly 4 digits."),
    confirm: z.string().trim(),
  })
  .refine((d) => d.pin === d.confirm, {
    message: "PINs don't match.",
    path: ["confirm"],
  });

// Resolves the sc_employees row for (tenant, app_user_id) — used to verify
// the employee really belongs to this tenant and to revalidate the right
// edit page path after a write. Returns null if no match.
async function findEmployeeIdByAppUser(
  tenantId: string,
  appUserId: string,
): Promise<string | null> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scEmployees.id })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.appUserId, appUserId),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  return rows[0]?.id ?? null;
}

export async function setPinAction(
  appUserId: string,
  _prev: PinFormState,
  formData: FormData,
): Promise<PinFormState> {
  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "You don't have permission to set kiosk PINs.",
    };
  }
  const tenantId = membership.tenant.id;

  const parsed = pinSchema.safeParse({
    pin: formData.get("pin"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.errors[0]?.message ?? "Invalid PIN.",
    };
  }

  const employeeId = await findEmployeeIdByAppUser(tenantId, appUserId);
  if (!employeeId) {
    return {
      status: "error",
      message: "Employee not found in this workspace.",
    };
  }

  // Collision check. PIN uniqueness is intentionally NOT enforced at the
  // DB level (no unique index on the hash — which couldn't exist anyway
  // since bcrypt salts every hash differently). We catch collisions HERE
  // in the manager-facing action so the kiosk surface itself can rely on
  // "one PIN matches at most one user". The original "no enumeration"
  // property is preserved on the kiosk (a wrong PIN at /kiosk always
  // returns generic "Wrong PIN" — never "this PIN is taken"); leaking
  // collision presence to a Manager+ is the right trade.
  const others = await forTenant(tenantId).run((tx) =>
    tx
      .select({ pinHash: scEmployeePins.pinHash })
      .from(scEmployeePins)
      .where(
        and(
          eq(scEmployeePins.traceyTenantId, tenantId),
          sql`${scEmployeePins.appUserId} <> ${appUserId}`,
        ),
      ),
  );
  for (const o of others) {
    if (await verifyPassword(parsed.data.pin, o.pinHash)) {
      return {
        status: "error",
        message:
          "Another employee already uses that PIN — pick a different one.",
      };
    }
  }

  const me = await currentUser();
  const pinHash = await hashPassword(parsed.data.pin);

  // Upsert via INSERT … ON CONFLICT — one PIN per (tenant, app_user). On
  // rotate, reset lastUsedAt so the audit display doesn't show a stale
  // "last used" tied to the old PIN.
  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scEmployeePins)
      .values({
        traceyTenantId: tenantId,
        appUserId,
        pinHash,
        setByUserId: me?.id ?? null,
      })
      .onConflictDoUpdate({
        target: [scEmployeePins.traceyTenantId, scEmployeePins.appUserId],
        set: {
          pinHash,
          setByUserId: me?.id ?? null,
          updatedAt: new Date(),
          lastUsedAt: null,
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.kiosk.pin_set",
    targetKind: "sc_employee_pin",
    targetId: appUserId,
  });

  revalidatePath(`/app/employees/${employeeId}/edit`);
  return { status: "ok", message: "PIN saved." };
}

export async function removePinAction(formData: FormData): Promise<void> {
  const appUserId = String(formData.get("appUserId") ?? "");
  if (!appUserId) return;

  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) return;
  const tenantId = membership.tenant.id;

  const employeeId = await findEmployeeIdByAppUser(tenantId, appUserId);
  if (!employeeId) return;

  await forTenant(tenantId).run((tx) =>
    tx
      .delete(scEmployeePins)
      .where(
        and(
          eq(scEmployeePins.appUserId, appUserId),
          eq(scEmployeePins.traceyTenantId, tenantId),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.kiosk.pin_removed",
    targetKind: "sc_employee_pin",
    targetId: appUserId,
  });

  revalidatePath(`/app/employees/${employeeId}/edit`);
}

// ─── Workspace role management ───
//
// Changes the role on `app.members` for the auth user attached to this
// employee row. Three safety guards:
//
//   1. Only owners (UI label: Admin) can promote anyone TO or demote
//      anyone FROM the owner role. Managers can only flip between
//      member ↔ admin (Employee ↔ Manager in UI parlance).
//   2. Last-owner protection: refuse to demote the final remaining
//      owner so a tenant can't accidentally lock itself out of
//      billing / membership management.
//   3. The client component issues a confirm() prompt when the target
//      is the viewer themselves AND the new role is lower-ranked —
//      see _role_card.tsx.

export type RoleFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

const roleSchema = z.object({
  role: z.enum(["owner", "admin", "member"]),
});

export async function setMemberRoleAction(
  targetAppUserId: string,
  _prev: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "You don't have permission to change roles.",
    };
  }
  const tenantId = membership.tenant.id;

  const parsed = roleSchema.safeParse({ role: formData.get("role") });
  if (!parsed.success) {
    return { status: "error", message: "Pick a valid role." };
  }
  const newRole = parsed.data.role as Role;

  // Look up the target's current membership in this tenant.
  const [target] = await db
    .select({ id: members.id, role: members.role })
    .from(members)
    .where(
      and(
        eq(members.userId, targetAppUserId),
        eq(members.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!target) {
    return {
      status: "error",
      message: "That person isn't a member of this workspace.",
    };
  }

  // No-op: same role selected. Silently succeed.
  if (target.role === newRole) {
    return { status: "ok", message: "Role unchanged." };
  }

  // Guard 1: owner-gated changes.
  const viewerIsOwner = membership.role === "owner";
  if (!viewerIsOwner && (newRole === "owner" || target.role === "owner")) {
    return {
      status: "error",
      message: "Only an Admin can change Admin-level roles.",
    };
  }

  // Guard 2: last-owner protection. If we're demoting the only remaining
  // owner, refuse — they must promote someone else first.
  if (target.role === "owner" && newRole !== "owner") {
    const countRows = (await db
      .select({ c: sql<number>`count(*)::int` })
      .from(members)
      .where(
        and(eq(members.tenantId, tenantId), eq(members.role, "owner")),
      )) as Array<{ c: number }>;
    const ownerCount = countRows[0]?.c ?? 0;
    if (ownerCount <= 1) {
      return {
        status: "error",
        message:
          "Can't demote the last Admin — promote someone else to Admin first.",
      };
    }
  }

  await db
    .update(members)
    .set({ role: newRole })
    .where(
      and(
        eq(members.userId, targetAppUserId),
        eq(members.tenantId, tenantId),
      ),
    );

  await logAuditEvent({
    action: "tenant.member.role_changed",
    targetKind: "tenant_member",
    targetId: target.id,
    details: {
      before: target.role,
      after: newRole,
      targetUserId: targetAppUserId,
    },
  });

  // Revalidate both the edit page (so the radios reflect the new state)
  // and the list page (so badges update).
  const employeeId = await findEmployeeIdByAppUser(tenantId, targetAppUserId);
  if (employeeId) revalidatePath(`/app/employees/${employeeId}/edit`);
  revalidatePath("/app/employees");
  revalidatePath("/app/team");
  return { status: "ok", message: "Role updated." };
}

// ─── Payroll PII (AUDIT.md Phase 2 #2a) ───
//
// TFN, BSB+account, and super-fund member number are encrypted with the
// @tracey/db pii helper before they hit Postgres. The plaintext is never
// stored, never logged. The "Reveal" action below decrypts on demand and
// writes a `shiftcraft.employee.pii_revealed` audit event so reveals
// leave a trail.

export type PayrollPiiFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

// AU TFN is 8-9 digits. BSB is exactly 6 digits (xxx-xxx accepted). Account
// numbers vary (6-10 digits typical). All accept empty to clear the field.
const payrollPiiSchema = z.object({
  tfn: z
    .union([
      z.literal(""),
      z.string().trim().regex(/^\d{3}\s?\d{3}\s?\d{2,3}$/, "TFN is 8-9 digits"),
    ])
    .optional(),
  bsb: z
    .union([
      z.literal(""),
      z.string().trim().regex(/^\d{3}-?\d{3}$/, "BSB is 6 digits (xxx-xxx)"),
    ])
    .optional(),
  accountNumber: z
    .union([
      z.literal(""),
      z.string().trim().regex(/^\d{4,12}$/, "Account number is 4-12 digits"),
    ])
    .optional(),
  superFundName: z.string().trim().max(120).optional().or(z.literal("")),
  superMemberNumber: z
    .union([
      z.literal(""),
      z.string().trim().min(2).max(40),
    ])
    .optional(),
});

export async function savePayrollPiiAction(
  employeeId: string,
  _prev: PayrollPiiFormState,
  formData: FormData,
): Promise<PayrollPiiFormState> {
  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "You don't have permission to edit payroll details.",
    };
  }
  const tenantId = membership.tenant.id;

  const parsed = payrollPiiSchema.safeParse({
    tfn: formData.get("tfn") ?? "",
    bsb: formData.get("bsb") ?? "",
    accountNumber: formData.get("accountNumber") ?? "",
    superFundName: formData.get("superFundName") ?? "",
    superMemberNumber: formData.get("superMemberNumber") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Verify the row belongs to this tenant before we touch anything.
  const [target] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scEmployees.id })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.id, employeeId),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!target) {
    return {
      status: "error",
      message: "Employee not found in this workspace.",
    };
  }

  // Normalise spacing/dashes before encrypting so reveals come back in a
  // single canonical form (the regex above accepts both "062-000" and
  // "062000"; we store as digits-only).
  const tfn = emptyToNull(parsed.data.tfn)?.replace(/\s/g, "") ?? null;
  const bsb = emptyToNull(parsed.data.bsb)?.replace(/-/g, "") ?? null;
  const accountNumber = emptyToNull(parsed.data.accountNumber);
  const superFundName = emptyToNull(parsed.data.superFundName);
  const superMemberNumber = emptyToNull(parsed.data.superMemberNumber);

  await forTenant(tenantId).run((tx) =>
    tx
      .update(scEmployees)
      .set({
        tfnEnc: encryptPii(tfn),
        bsbEnc: encryptPii(bsb),
        accountNumberEnc: encryptPii(accountNumber),
        superFundName,
        superMemberNumberEnc: encryptPii(superMemberNumber),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scEmployees.id, employeeId),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      ),
  );

  // Audit which fields were set vs cleared. We never log the plaintext —
  // only the field names so the trail says *what* changed, not *to what*.
  await logAuditEvent({
    action: "shiftcraft.employee.pii_saved",
    targetKind: "sc_employee",
    targetId: employeeId,
    details: {
      fields: {
        tfn: tfn ? "set" : "cleared",
        bsb: bsb ? "set" : "cleared",
        accountNumber: accountNumber ? "set" : "cleared",
        superFundName: superFundName ? "set" : "cleared",
        superMemberNumber: superMemberNumber ? "set" : "cleared",
      },
    },
  });

  revalidatePath(`/app/employees/${employeeId}/edit`);
  return { status: "ok", message: "Saved." };
}

export interface RevealedPayrollPii {
  tfn: string | null;
  bsb: string | null;
  accountNumber: string | null;
  superMemberNumber: string | null;
}

// Decrypts the encrypted columns and returns plaintext to the caller.
// Writes a `pii_revealed` audit event with the field names (NOT the
// values). Caller is responsible for showing the values in a transient
// UI and never persisting them to client storage.
export async function revealPayrollPiiAction(
  employeeId: string,
): Promise<
  | { status: "ok"; data: RevealedPayrollPii }
  | { status: "error"; message: string }
> {
  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "You don't have permission to reveal payroll details.",
    };
  }
  const tenantId = membership.tenant.id;

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        tfnEnc: scEmployees.tfnEnc,
        bsbEnc: scEmployees.bsbEnc,
        accountNumberEnc: scEmployees.accountNumberEnc,
        superMemberNumberEnc: scEmployees.superMemberNumberEnc,
      })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.id, employeeId),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!row) {
    return {
      status: "error",
      message: "Employee not found in this workspace.",
    };
  }

  await logAuditEvent({
    action: "shiftcraft.employee.pii_revealed",
    targetKind: "sc_employee",
    targetId: employeeId,
    details: {
      fields: ["tfn", "bsb", "accountNumber", "superMemberNumber"],
    },
  });

  return {
    status: "ok",
    data: {
      tfn: decryptPii(row.tfnEnc ?? null),
      bsb: decryptPii(row.bsbEnc ?? null),
      accountNumber: decryptPii(row.accountNumberEnc ?? null),
      superMemberNumber: decryptPii(row.superMemberNumberEnc ?? null),
    },
  };
}

export async function deleteEmployeeAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await currentMembership();
  if (!membership) return;
  // Pull the name so the audit log entry is meaningful after the row is gone.
  const [doomed] = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({ fullName: scEmployees.fullName, email: scEmployees.email })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.id, id),
          eq(scEmployees.traceyTenantId, membership.tenant.id),
        ),
      )
      .limit(1),
  );
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .delete(scEmployees)
      .where(
        and(
          eq(scEmployees.id, id),
          eq(scEmployees.traceyTenantId, membership.tenant.id),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.employee.deleted",
    targetKind: "sc_employee",
    targetId: id,
    details: doomed ? { fullName: doomed.fullName, email: doomed.email } : null,
  });
  revalidatePath("/app/employees");
  redirect("/app/employees");
}
