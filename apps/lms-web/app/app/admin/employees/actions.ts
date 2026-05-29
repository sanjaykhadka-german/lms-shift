"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  forTenant,
  lmsEmployers,
  lmsMachines,
  lmsUserMachines,
  lmsUsers,
  members,
  users,
} from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { createAdminClient } from "~/lib/supabase/admin";
import { mapFlaskRole } from "~/lib/auth/legacy-bridge";
import { logAuditEvent } from "~/lib/audit";
import { sendInviteEmail, sendPasswordResetEmail } from "~/lib/lms/notify-admin";
import { deleteStoredPhoto, PhotoUploadError, saveUserPhoto } from "~/lib/lms/photos";
import { autoAssignForDepartment } from "~/lib/lms/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import type { FormState } from "../_components/NameCrudForm";

const VALID_ROLES = ["admin", "qaqc", "employee"] as const;
type LmsRole = (typeof VALID_ROLES)[number];

const intish = z
  .string()
  .optional()
  .transform((s) => (s && /^\d+$/.test(s) ? parseInt(s, 10) : null));

const dateish = z
  .string()
  .optional()
  .transform((s) => {
    if (!s) return null;
    const t = s.trim();
    if (!t) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      throw new z.ZodError([
        { code: "custom", path: ["date"], message: "Use YYYY-MM-DD" },
      ]);
    }
    return t;
  });

const createSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().min(1, "Phone is required"),
  departmentId: intish.refine((v) => v !== null, "Department is required"),
  employerName: z.string().trim().min(1, "Employer is required"),
  role: z.string().refine((r) => (VALID_ROLES as readonly string[]).includes(r), {
    message: "Invalid role",
  }),
  jobTitle: z.string().trim().optional(),
  positionId: intish,
  startDate: dateish.optional(),
  terminationDate: dateish.optional(),
});

async function getOrCreateEmployer(name: string, tenantId: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Employer name required");
  return forTenant(tenantId).run(async (tx) => {
    const existing = await tx
      .select({ id: lmsEmployers.id })
      .from(lmsEmployers)
      .where(and(eq(lmsEmployers.name, trimmed), tenantWhere(lmsEmployers, tenantId)))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [row] = await tx
      .insert(lmsEmployers)
      .values({ name: trimmed, traceyTenantId: tenantId })
      .returning({ id: lmsEmployers.id });
    return row!.id;
  });
}

function generateTempPassword(): string {
  // Same shape as Flask's secrets.token_urlsafe(9): ~12 url-safe chars.
  return crypto.randomBytes(9).toString("base64url");
}

export async function createEmployeeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;

  let parsed;
  try {
    parsed = createSchema.safeParse({
      firstName: formData.get("first_name"),
      lastName: formData.get("last_name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      departmentId: String(formData.get("department_id") ?? ""),
      employerName: formData.get("employer_name"),
      role: formData.get("role") ?? "employee",
      jobTitle: formData.get("job_title") ?? "",
      positionId: String(formData.get("position_id") ?? ""),
      startDate: formData.get("start_date") ?? "",
      terminationDate: formData.get("termination_date") ?? "",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        status: "error",
        message: "Date format wrong: use YYYY-MM-DD.",
      };
    }
    throw err;
  }
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Tracey admins can't create another `admin` (matches Flask behavior:
  // it warns and downgrades). For Tracey we just refuse.
  let role: LmsRole = data.role as LmsRole;
  if (role === "admin" && ctx.role !== "owner") {
    role = "qaqc";
  }

  // users.email has a global UNIQUE constraint (Phase-2 SSO contract). Two
  // tenants therefore cannot share an email â€” surface that as a duplicate
  // error rather than silently failing on the constraint.
  // allow-cross-tenant: public.users excluded from RLS; cross-tenant email
  // lookup is intentional to detect collisions across workspaces.
  const dupe = await db
    .select({ id: lmsUsers.id, traceyTenantId: lmsUsers.traceyTenantId })
    .from(lmsUsers)
    .where(eq(lmsUsers.email, data.email))
    .limit(1);
  if (dupe[0]) {
    if (dupe[0].traceyTenantId !== tid) {
      return {
        status: "error",
        message: "That email already belongs to another workspace's user.",
      };
    }
    return { status: "error", message: "A user with this email already exists." };
  }

  const employerId = await getOrCreateEmployer(data.employerName, tid);
  const fullName = `${data.firstName} ${data.lastName}`.trim();
  const tempPw = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPw, 12);

  const [row] = await ctx.db.run((tx) =>
    tx
      .insert(lmsUsers)
      .values({
        email: data.email,
        name: fullName,
        firstName: data.firstName,
        lastName: data.lastName,
        passwordHash,
        role,
        isActiveFlag: true,
        phone: data.phone,
        departmentId: data.departmentId,
        employerId,
        startDate: data.startDate ?? null,
        terminationDate: data.terminationDate ?? null,
        jobTitle: data.jobTitle ?? "",
        positionId: data.positionId,
        traceyTenantId: tid,
      })
      .returning({ id: lmsUsers.id }),
  );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employee.created",
    targetKind: "user",
    targetId: String(row?.id ?? ""),
    details: { email: data.email, role },
  });

  const extraModuleIds = formData
    .getAll("extra_module_ids")
    .map(String)
    .filter((s) => /^\d+$/.test(s))
    .map((s) => parseInt(s, 10));

  const newId = row?.id;
  const autoAssigned = newId
    ? await autoAssignForDepartment({
        userId: newId,
        departmentId: data.departmentId,
        traceyTenantId: tid,
        tenantTimezone: ctx.tenantTimezone,
        additionalModuleIds: extraModuleIds,
      })
    : 0;

  const emailed = await sendInviteEmail({
    to: data.email,
    name: fullName,
    tempPassword: tempPw,
  });

  revalidatePath("/app/admin/employees");
  const parts = [
    `${fullName} added.`,
    emailed ? "Invite emailed." : `Email not sent â€” temp password: ${tempPw}`,
  ];
  if (autoAssigned > 0) {
    parts.push(`${autoAssigned} module${autoAssigned === 1 ? "" : "s"} assigned.`);
  }
  return { status: "ok", message: parts.join(" ") };
}

const statusSchema = z.object({
  id: z.coerce.number().int().positive(),
  status: z.enum(["active", "disabled", "terminated"]),
});

export async function setEmployeeStatusAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const parsed = statusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
  });
  if (!parsed.success) throw new Error("Bad status change");

  const [target] = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsUsers)
      .where(and(eq(lmsUsers.id, parsed.data.id), eq(lmsUsers.traceyTenantId, tid)))
      .limit(1),
  );
  if (!target) throw new Error("User not found");

  // Match Flask's "can't disable yourself" guard.
  if (target.id === ctx.lmsUser.id) {
    redirect("/app/admin/employees?error=self_toggle");
  }
  // Tracey admins can't change LMS admins' status; only owners can.
  if (target.role === "admin" && ctx.role !== "owner") {
    redirect("/app/admin/employees?error=forbidden");
  }

  const today = new Date().toISOString().slice(0, 10);
  let updates: { isActiveFlag?: boolean; terminationDate?: string | null };
  let auditAction: string;
  switch (parsed.data.status) {
    case "active":
      // Clear a *past* termination date so the user comes back to active;
      // a future termination date (scheduled exit) is preserved.
      updates = { isActiveFlag: true };
      if (target.terminationDate && target.terminationDate < today) {
        updates.terminationDate = null;
      }
      auditAction = "employee.activated";
      break;
    case "disabled":
      updates = { isActiveFlag: false };
      auditAction = "employee.disabled";
      break;
    case "terminated":
      updates = { isActiveFlag: false, terminationDate: today };
      auditAction = "employee.terminated";
      break;
  }

  await ctx.db.run((tx) =>
    tx
      .update(lmsUsers)
      .set(updates)
      .where(and(eq(lmsUsers.id, parsed.data.id), eq(lmsUsers.traceyTenantId, tid))),
  );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: auditAction,
    targetKind: "user",
    targetId: String(parsed.data.id),
    details: { email: target.email, status: parsed.data.status },
  });
  revalidatePath("/app/admin/employees");
}

const roleSchema = z.object({
  id: z.coerce.number().int().positive(),
  role: z.enum(VALID_ROLES),
});

export async function changeEmployeeRoleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const parsed = roleSchema.safeParse({
    id: formData.get("id"),
    role: formData.get("role"),
  });
  if (!parsed.success) throw new Error("Invalid role change");
  // Tracey admins can promote/demote within (qaqc, employee). Only owners
  // can grant or remove the LMS `admin` role. Mirrors Flask's
  // @admin_required gate (app.py:2816).
  if (parsed.data.role === "admin" && ctx.role !== "owner") {
    redirect("/app/admin/employees?error=forbidden");
  }

  const [target] = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsUsers)
      .where(and(eq(lmsUsers.id, parsed.data.id), eq(lmsUsers.traceyTenantId, tid)))
      .limit(1),
  );
  if (!target) throw new Error("User not found");
  if (target.id === ctx.lmsUser.id) {
    redirect("/app/admin/employees?error=self_role");
  }
  // Cannot remove the admin role from someone else if you're not an owner.
  if (target.role === "admin" && ctx.role !== "owner") {
    redirect("/app/admin/employees?error=forbidden");
  }

  await ctx.db.run((tx) =>
    tx
      .update(lmsUsers)
      .set({ role: parsed.data.role })
      .where(and(eq(lmsUsers.id, parsed.data.id), eq(lmsUsers.traceyTenantId, tid))),
  );

  // Mirror into Tracey membership so requireAdmin's role check stays in
  // sync. Skip if the employee hasn't bridged yet — the legacy bridge
  // picks the right members.role on first sign-in via mapFlaskRole.
  // allow-cross-tenant: app.members is uuid-keyed, not RLS-covered.
  if (target.traceyUserId) {
    await db
      .update(members)
      .set({ role: mapFlaskRole(parsed.data.role) })
      .where(
        and(
          eq(members.tenantId, tid),
          eq(members.userId, target.traceyUserId),
        ),
      );
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employee.role_changed",
    targetKind: "user",
    targetId: String(parsed.data.id),
    details: { email: target.email, from: target.role, to: parsed.data.role },
  });
  revalidatePath("/app/admin/employees");
}

export async function resetEmployeePasswordAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const [target] = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsUsers)
      .where(and(eq(lmsUsers.id, id), eq(lmsUsers.traceyTenantId, tid)))
      .limit(1),
  );
  if (!target) throw new Error("User not found");
  if (target.role === "admin" && ctx.role !== "owner") {
    redirect("/app/admin/employees?error=forbidden");
  }

  const tempPw = generateTempPassword();
  const hash = await bcrypt.hash(tempPw, 12);
  await ctx.db.run((tx) =>
    tx
      .update(lmsUsers)
      .set({ passwordHash: hash })
      .where(and(eq(lmsUsers.id, id), eq(lmsUsers.traceyTenantId, tid))),
  );

  // Set the password on the Supabase auth user (the source of truth for
  // login) via the service-role admin API. Skip if the employee has never
  // signed up yet (no linked auth user) — they'll set their own password on
  // first sign-up.
  if (target.traceyUserId) {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(target.traceyUserId, {
      password: tempPw,
    });
    if (error) {
      throw new Error(`Failed to reset password: ${error.message}`);
    }
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employee.password_reset",
    targetKind: "user",
    targetId: String(id),
    details: { email: target.email },
  });

  // Best-effort email; the temp password also surfaces via the redirect param
  // so an admin can share it manually.
  const emailed = await sendPasswordResetEmail({
    to: target.email,
    name: target.name,
    tempPassword: tempPw,
  });
  redirect(
    `/app/admin/employees/${id}/edit?reset=1&pw=${encodeURIComponent(tempPw)}&emailed=${emailed ? "1" : "0"}`,
  );
}

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: z.string().trim().min(1, "Phone is required"),
  departmentId: intish.refine((v) => v !== null, "Department is required"),
  employerName: z.string().trim().min(1, "Employer is required"),
  jobTitle: z.string().trim().optional(),
  positionId: intish,
  startDate: dateish.optional(),
  terminationDate: dateish.optional(),
});

export async function updateEmployeeAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  let parsed;
  try {
    parsed = updateSchema.safeParse({
      id: formData.get("id"),
      firstName: formData.get("first_name"),
      lastName: formData.get("last_name"),
      phone: formData.get("phone"),
      departmentId: String(formData.get("department_id") ?? ""),
      employerName: formData.get("employer_name"),
      jobTitle: formData.get("job_title") ?? "",
      positionId: String(formData.get("position_id") ?? ""),
      startDate: formData.get("start_date") ?? "",
      terminationDate: formData.get("termination_date") ?? "",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const id = parseInt(String(formData.get("id") ?? "0"), 10);
      redirect(`/app/admin/employees/${id}/edit?error=date`);
    }
    throw err;
  }
  if (!parsed.success) {
    const id = parseInt(String(formData.get("id") ?? "0"), 10);
    redirect(`/app/admin/employees/${id}/edit?error=missing`);
  }
  const data = parsed.data;

  const [target] = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsUsers)
      .where(and(eq(lmsUsers.id, data.id), eq(lmsUsers.traceyTenantId, tid)))
      .limit(1),
  );
  if (!target) throw new Error("User not found");
  if (target.role === "admin" && ctx.role !== "owner") {
    redirect("/app/admin/employees?error=forbidden");
  }

  const employerId = await getOrCreateEmployer(data.employerName, tid);
  const machineIds = formData
    .getAll("machine_ids")
    .map(String)
    .filter((s) => /^\d+$/.test(s))
    .map((s) => parseInt(s, 10));

  // Photo handling. Three branches: new file uploaded â†’ save + replace;
  // remove_photo checkbox checked â†’ null + delete previous; otherwise leave
  // the column alone.
  const photoEntry = formData.get("photo");
  const removePhoto = formData.get("remove_photo") === "1";
  let nextPhotoFilename: string | null | undefined = undefined;
  if (photoEntry instanceof File && photoEntry.size > 0) {
    try {
      nextPhotoFilename = await saveUserPhoto({
        file: photoEntry,
        uploadedByLmsUserId: ctx.lmsUser.id,
        previousFilename: target.photoFilename,
        traceyTenantId: tid,
      });
    } catch (err) {
      if (err instanceof PhotoUploadError) {
        redirect(`/app/admin/employees/${data.id}/edit?error=photo&msg=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }
  } else if (removePhoto && target.photoFilename) {
    nextPhotoFilename = null;
    await deleteStoredPhoto(target.photoFilename, tid);
  }

  const fullName = `${data.firstName} ${data.lastName}`.trim();
  await ctx.db.run(async (tx) => {
    await tx
      .update(lmsUsers)
      .set({
        firstName: data.firstName,
        lastName: data.lastName,
        name: fullName,
        phone: data.phone,
        departmentId: data.departmentId,
        employerId,
        startDate: data.startDate ?? null,
        terminationDate: data.terminationDate ?? null,
        jobTitle: data.jobTitle ?? "",
        positionId: data.positionId,
        ...(nextPhotoFilename !== undefined ? { photoFilename: nextPhotoFilename } : {}),
      })
      .where(and(eq(lmsUsers.id, data.id), eq(lmsUsers.traceyTenantId, tid)));

    // Sync user_machines M2M.
    await tx
      .delete(lmsUserMachines)
      .where(and(eq(lmsUserMachines.userId, data.id), tenantWhere(lmsUserMachines, tid)));
    if (machineIds.length > 0) {
      const real = await tx
        .select({ id: lmsMachines.id })
        .from(lmsMachines)
        .where(and(inArray(lmsMachines.id, machineIds), tenantWhere(lmsMachines, tid)));
      const realIds = real.map((r) => r.id);
      if (realIds.length > 0) {
        await tx.insert(lmsUserMachines).values(
          realIds.map((machineId) => ({ userId: data.id, machineId, traceyTenantId: tid })),
        );
      }
    }
  });

  // Mirror the display name into Tracey so the topbar greeting and any
  // other UI reading users.name stays in sync. Same pattern as
  // updateProfileAction. Skip if the employee hasn't bridged yet.
  // allow-cross-tenant: app.users is uuid-keyed, not RLS-covered.
  if (target.traceyUserId) {
    await db
      .update(users)
      .set({ name: fullName, updatedAt: new Date() })
      .where(eq(users.id, target.traceyUserId));
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employee.updated",
    targetKind: "user",
    targetId: String(data.id),
    details: { email: target.email },
  });

  // If the user moved to a different department, auto-assign any new
  // department-policy modules. Same condition Flask uses (app.py:2924).
  if (target.departmentId !== data.departmentId) {
    await autoAssignForDepartment({
      userId: data.id,
      departmentId: data.departmentId,
      traceyTenantId: tid,
      tenantTimezone: ctx.tenantTimezone,
    });
  }

  revalidatePath("/app/admin/employees");
  redirect("/app/admin/employees");
}

