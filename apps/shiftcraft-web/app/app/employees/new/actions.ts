"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  forTenant,
  invitations,
  members,
  scDepartments,
  scEmployeePins,
  scEmployees,
  scLocations,
  users,
  type Role,
} from "@tracey/db";
import { decryptPii, encryptPii } from "@tracey/db/pii";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { sendInvitationEmail } from "~/lib/auth/email";
import { hashPassword, verifyPassword } from "~/lib/auth/passwords";
import { generateToken, tokenExpiry } from "~/lib/auth/tokens";
import { logAuditEvent } from "~/lib/audit";
import { notifyTenantAdmins } from "~/lib/notifications";
import { isAtLeastManager } from "~/lib/roles";
import { emitWebhook } from "~/lib/webhooks";

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
  position: z.string().trim().max(80).optional().or(z.literal("")),
  locationId: z
    .union([z.literal(""), z.string().uuid("Pick a valid location")])
    .optional(),
  employmentType: z.enum(["full_time", "part_time", "casual", "contractor"]),
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
 * Confirm `locationId` is a real sc_locations row in this tenant before we
 * write it onto an employee. The per-tenant FK would reject a bad id with a
 * 23503, but checking here turns that into a friendly field error and keeps
 * a stale dropdown value (location deleted mid-edit) from 500-ing.
 */
async function locationBelongsToTenant(
  tenantId: string,
  locationId: string,
): Promise<boolean> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scLocations.id })
      .from(scLocations)
      .where(
        and(
          eq(scLocations.id, locationId),
          eq(scLocations.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
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
    position: formData.get("position") ?? "",
    locationId: formData.get("locationId") ?? "",
    employmentType: formData.get("employmentType") ?? "full_time",
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
  const position = emptyToNull(parsed.data.position);
  const locationId = emptyToNull(parsed.data.locationId);
  const notes = emptyToNull(parsed.data.notes);
  const availability = collectAvailability(formData);

  if (locationId && !(await locationBelongsToTenant(tenantId, locationId))) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { locationId: ["That location no longer exists."] },
    };
  }

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

  let newEmployeeId: string | null = null;
  try {
    await forTenant(tenantId).run(async (tx) => {
      const departmentId = await resolveDepartmentId(tx, tenantId, department);
      const [inserted] = await tx
        .insert(scEmployees)
        .values({
          traceyTenantId: tenantId,
          fullName: parsed.data.fullName,
          email,
          mobile,
          departmentId,
          locationId,
          position,
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
        })
        .returning({ id: scEmployees.id });
      newEmployeeId = inserted?.id ?? null;
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
  // staff member who would normally need training. Contractors are skipped
  // by design — they're not part of the training cohort.
  if (email && parsed.data.employmentType !== "contractor") {
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

  // Auto-invite (AUDIT.md Phase 2 #2b): if the admin opted in via the form
  // checkbox and the gate conditions hold, fire a workspace invitation so
  // the new employee can claim their account from the standard
  // /accept-invite page (hosted on lms-web). Skipped silently when:
  //   - no email             — no address to send to
  //   - contractor           — roster-only, no login needed
  //   - already linked       — already a tenant member; auto-link covers it
  //   - already invited      — pending invitation exists; don't duplicate
  //   - no `me`              — invitedByUserId is NOT NULL on the schema
  // Email failures are best-effort: the invitation row is rolled back so a
  // future create / /app/people/team invite can try again cleanly.
  const wantsInvite = formData.get("sendInvite") === "on";
  let invited = false;
  if (
    wantsInvite &&
    email &&
    parsed.data.employmentType !== "contractor" &&
    linkedAppUserId === null &&
    me
  ) {
    const [existingInvite] = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(eq(invitations.tenantId, tenantId), eq(invitations.email, email)),
      )
      .limit(1);
    if (!existingInvite) {
      const token = generateToken();
      const [invRow] = await db
        .insert(invitations)
        .values({
          tenantId,
          email,
          role: "member",
          token,
          expiresAt: tokenExpiry(24 * 7),
          invitedByUserId: me.id,
        })
        .returning({ id: invitations.id });
      try {
        await sendInvitationEmail({
          to: email,
          token,
          tenantName: membership.tenant.name,
          inviterName: me.name,
        });
        invited = true;
        await logAuditEvent({
          action: "tenant.member.invited",
          targetKind: "invitation",
          targetId: invRow?.id ?? null,
          details: {
            email,
            role: "member",
            source: "shiftcraft.employee_create",
          },
        });
      } catch (err) {
        console.error("[employees] invitation email failed:", err);
        await db.delete(invitations).where(eq(invitations.token, token));
      }
    }
  }

  // AUDIT.md #10 — outbound webhook for the new hire. Skipped if the
  // RETURNING clause came back empty (defensive — shouldn't happen on
  // a successful insert).
  if (newEmployeeId) {
    await emitWebhook(tenantId, "employee.created", {
      employeeId: newEmployeeId,
      fullName: parsed.data.fullName,
      email,
      employmentType: parsed.data.employmentType,
      department,
      createdByUserId: me?.id ?? null,
    });
  }

  revalidatePath("/app/employees");
  redirect(`/app/employees?added=1${invited ? "&invited=1" : ""}`);
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
    position: formData.get("position") ?? "",
    locationId: formData.get("locationId") ?? "",
    employmentType: formData.get("employmentType") ?? "full_time",
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
  const position = emptyToNull(parsed.data.position);
  const locationId = emptyToNull(parsed.data.locationId);
  const notes = emptyToNull(parsed.data.notes);
  const availability = collectAvailability(formData);
  const hourlyRate = emptyToNull(parsed.data.hourlyRate);

  if (locationId && !(await locationBelongsToTenant(tenantId, locationId))) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { locationId: ["That location no longer exists."] },
    };
  }

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
        locationId,
        position,
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
// because clock events are keyed on the same identifier. Contractor roster
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

// ─── Login password reset (admin override) ───
//
// Lets a Manager+ set a new web-login password for an employee's attached auth
// account (app.users) — e.g. the worker forgot theirs and there's no email
// delivery set up. No "current password" needed (that's the self-service flow
// on /app/settings). Bumps passwordChangedAt so any JWT minted before now is
// rejected at the next requireUser(), forcing a re-login with the new password.

export type ResetPasswordFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

const resetPasswordSchema = z
  .object({
    next: z.string().min(8, "Use at least 8 characters.").max(200, "Too long."),
    confirm: z.string(),
  })
  .refine((d) => d.next === d.confirm, {
    message: "Passwords don't match.",
    path: ["confirm"],
  });

export async function resetEmployeePasswordAction(
  appUserId: string,
  _prev: ResetPasswordFormState,
  formData: FormData,
): Promise<ResetPasswordFormState> {
  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "You don't have permission to reset passwords.",
    };
  }
  const tenantId = membership.tenant.id;

  const parsed = resetPasswordSchema.safeParse({
    next: formData.get("next") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.errors[0]?.message ?? "Invalid password.",
    };
  }

  // Confirm the target is an employee in THIS tenant before touching the
  // shared app.users row (defence against editing arbitrary user ids).
  const employeeId = await findEmployeeIdByAppUser(tenantId, appUserId);
  if (!employeeId) {
    return { status: "error", message: "Employee not found in this workspace." };
  }
  // …and that they're actually a member of this tenant.
  const [memberRow] = await db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.userId, appUserId), eq(members.tenantId, tenantId)))
    .limit(1);
  if (!memberRow) {
    return { status: "error", message: "That employee has no login account." };
  }

  const newHash = await hashPassword(parsed.data.next);
  await db
    .update(users)
    .set({
      passwordHash: newHash,
      passwordChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, appUserId));

  await logAuditEvent({
    action: "shiftcraft.employee.password_reset",
    targetKind: "app_user",
    targetId: appUserId,
  });

  revalidatePath(`/app/employees/${employeeId}/edit`);
  return {
    status: "ok",
    message: "Password reset. The employee must sign in with the new password.",
  };
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

// ─── Per-employee award profile (Phase 2 #3b.6) ──────────────────────
//
// Mirror of sc_tenant_config.award_profile but per employee. Employee
// overrides merge on top of the tenant profile per-leaf-field (see
// mergeAwardProfiles in lib/timesheet-classifier.ts). Storing only the
// fields the manager typed keeps "inheritance" intact when the tenant
// profile later changes.

export type EmployeeAwardFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

function asPositiveNumber(raw: FormDataEntryValue | null): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[\s,]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const employeeAwardSchema = z.object({
  dailyOrdinaryMinutes: z.number().positive().optional(),
  dailyOvertimeMinutes: z.number().positive().optional(),
  weeklyOrdinaryMinutes: z.number().positive().optional(),
  overtimeMultiplier: z.number().positive().optional(),
  doubleOvertimeMultiplier: z.number().positive().optional(),
  penaltyWeekday: z.number().positive().optional(),
  penaltySaturday: z.number().positive().optional(),
  penaltySunday: z.number().positive().optional(),
  penaltyPublicHoliday: z.number().positive().optional(),
  costPolicy: z.enum(["max", "stack"]).optional(),
});

export async function setEmployeeAwardProfileAction(
  employeeId: string,
  _prev: EmployeeAwardFormState,
  formData: FormData,
): Promise<EmployeeAwardFormState> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "Only Managers can change award profiles.",
    };
  }
  const tenantId = membership.tenant.id;

  // Verify the employee belongs to this tenant before any write.
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
    return { status: "error", message: "Employee not found in this workspace." };
  }

  const intent = String(formData.get("intent") ?? "save");
  if (intent === "reset") {
    await forTenant(tenantId).run((tx) =>
      tx
        .update(scEmployees)
        .set({ awardProfile: null, updatedAt: new Date() })
        .where(
          and(
            eq(scEmployees.id, employeeId),
            eq(scEmployees.traceyTenantId, tenantId),
          ),
        ),
    );
    await logAuditEvent({
      action: "shiftcraft.employee.award_profile_reset",
      targetKind: "sc_employee",
      targetId: employeeId,
      details: null,
    });
    revalidatePath(`/app/employees/${employeeId}/edit`);
    return { status: "ok", message: "Override cleared — employee inherits the tenant profile." };
  }

  const raw = {
    dailyOrdinaryMinutes: asPositiveNumber(formData.get("dailyOrdinaryMinutes")),
    dailyOvertimeMinutes: asPositiveNumber(formData.get("dailyOvertimeMinutes")),
    weeklyOrdinaryMinutes: asPositiveNumber(formData.get("weeklyOrdinaryMinutes")),
    overtimeMultiplier: asPositiveNumber(formData.get("overtimeMultiplier")),
    doubleOvertimeMultiplier: asPositiveNumber(
      formData.get("doubleOvertimeMultiplier"),
    ),
    penaltyWeekday: asPositiveNumber(formData.get("penaltyWeekday")),
    penaltySaturday: asPositiveNumber(formData.get("penaltySaturday")),
    penaltySunday: asPositiveNumber(formData.get("penaltySunday")),
    penaltyPublicHoliday: asPositiveNumber(formData.get("penaltyPublicHoliday")),
    costPolicy:
      formData.get("costPolicy") === "max" ||
      formData.get("costPolicy") === "stack"
        ? (formData.get("costPolicy") as "max" | "stack")
        : undefined,
  };
  const filtered = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== null && v !== undefined),
  );
  const parsed = employeeAwardSchema.safeParse(filtered);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  if (
    parsed.data.dailyOrdinaryMinutes != null &&
    parsed.data.dailyOvertimeMinutes != null &&
    parsed.data.dailyOvertimeMinutes < parsed.data.dailyOrdinaryMinutes
  ) {
    return {
      status: "error",
      message:
        "Daily OT ceiling must be greater than or equal to daily ordinary minutes.",
      fieldErrors: {
        dailyOvertimeMinutes: [
          "Must be ≥ dailyOrdinaryMinutes for the OT 1.5× band to make sense.",
        ],
      },
    };
  }

  const profile: Record<string, unknown> = {};
  const thresholds: Record<string, number> = {};
  if (parsed.data.dailyOrdinaryMinutes != null) {
    thresholds.dailyOrdinaryMinutes = parsed.data.dailyOrdinaryMinutes;
  }
  if (parsed.data.dailyOvertimeMinutes != null) {
    thresholds.dailyOvertimeMinutes = parsed.data.dailyOvertimeMinutes;
  }
  if (parsed.data.weeklyOrdinaryMinutes != null) {
    thresholds.weeklyOrdinaryMinutes = parsed.data.weeklyOrdinaryMinutes;
  }
  if (Object.keys(thresholds).length > 0) profile.thresholds = thresholds;
  if (parsed.data.overtimeMultiplier != null) {
    profile.overtimeMultiplier = parsed.data.overtimeMultiplier;
  }
  if (parsed.data.doubleOvertimeMultiplier != null) {
    profile.doubleOvertimeMultiplier = parsed.data.doubleOvertimeMultiplier;
  }
  const pms: Record<string, number> = {};
  if (parsed.data.penaltyWeekday != null) pms.weekday = parsed.data.penaltyWeekday;
  if (parsed.data.penaltySaturday != null) pms.saturday = parsed.data.penaltySaturday;
  if (parsed.data.penaltySunday != null) pms.sunday = parsed.data.penaltySunday;
  if (parsed.data.penaltyPublicHoliday != null) {
    pms.public_holiday = parsed.data.penaltyPublicHoliday;
  }
  if (Object.keys(pms).length > 0) profile.penaltyMultipliers = pms;
  if (parsed.data.costPolicy) profile.costPolicy = parsed.data.costPolicy;

  // Empty submitted form = clear the override. Distinct intent path
  // handles the explicit "Reset" button above; this catches the case
  // where the user blanked every field and pressed Save.
  const profileToStore = Object.keys(profile).length > 0 ? profile : null;

  await forTenant(tenantId).run((tx) =>
    tx
      .update(scEmployees)
      .set({ awardProfile: profileToStore, updatedAt: new Date() })
      .where(
        and(
          eq(scEmployees.id, employeeId),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.employee.award_profile_changed",
    targetKind: "sc_employee",
    targetId: employeeId,
    details: { profile: profileToStore },
  });

  revalidatePath(`/app/employees/${employeeId}/edit`);
  return {
    status: "ok",
    message: profileToStore
      ? "Override saved."
      : "Override cleared — employee inherits the tenant profile.",
  };
}
