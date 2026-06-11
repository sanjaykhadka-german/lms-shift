"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scDocuments,
  scEmployees,
  scEmployeeOnboardingTasks,
  scEmployeePins,
} from "@tracey/db";
import { encryptPii } from "@tracey/db/pii";
import { currentMembership, currentUser, requireUser } from "~/lib/auth/current";
import { hashPassword, verifyPassword } from "~/lib/auth/passwords";
import { logAuditEvent } from "~/lib/audit";

// ─── Worker-side onboarding actions (AUDIT.md #2 polish) ────────────
//
// Each action below MUST resolve the caller's OWN sc_employees row by
// matching app_user_id to currentUser.id. The form never carries an
// employeeId — there's no parameter to spoof — and the underlying row
// is looked up server-side every time. RLS handles cross-tenant; the
// ownership join handles cross-employee within the same tenant.

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

interface SelfContext {
  tenantId: string;
  userId: string;
  employeeId: string;
}

async function requireSelfEmployee(): Promise<SelfContext | null> {
  const membership = await currentMembership();
  if (!membership) return null;
  const user = await requireUser();
  const tenantId = membership.tenant.id;
  const [emp] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scEmployees.id })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.traceyTenantId, tenantId),
          eq(scEmployees.appUserId, user.id),
        ),
      )
      .limit(1),
  );
  if (!emp) return null;
  return { tenantId, userId: user.id, employeeId: emp.id };
}

// ─── Personal details ────────────────────────────────────────────────

const personalSchema = z.object({
  preferredName: z.string().trim().max(80).optional().or(z.literal("")),
  gender: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) =>
        !v || ["female", "male", "non_binary", "prefer_not_to_say"].includes(v),
      "Pick a valid value",
    ),
  dateOfBirth: z.string().optional().or(z.literal("")),
  addressLine: z.string().trim().max(300).optional().or(z.literal("")),
  emergencyContactName: z.string().trim().max(120).optional().or(z.literal("")),
  emergencyContactPhone: z.string().trim().max(40).optional().or(z.literal("")),
});

function emptyToNull(v: string | undefined | null): string | null {
  return v && v.length > 0 ? v : null;
}

export async function selfUpdatePersonalAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireSelfEmployee();
  if (!ctx) {
    return {
      status: "error",
      message: "You don't have a roster row yet — ask your manager.",
    };
  }
  const parsed = personalSchema.safeParse({
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

  await forTenant(ctx.tenantId).run((tx) =>
    tx
      .update(scEmployees)
      .set({
        preferredName: emptyToNull(parsed.data.preferredName),
        gender: emptyToNull(parsed.data.gender),
        dateOfBirth: emptyToNull(parsed.data.dateOfBirth),
        addressLine: emptyToNull(parsed.data.addressLine),
        emergencyContactName: emptyToNull(parsed.data.emergencyContactName),
        emergencyContactPhone: emptyToNull(parsed.data.emergencyContactPhone),
        // First save promotes pending → in_progress so the manager
        // queue surfaces ongoing onboarding.
        onboardingStatus: sql`CASE WHEN ${scEmployees.onboardingStatus} = 'pending' THEN 'in_progress' ELSE ${scEmployees.onboardingStatus} END`,
        onboardingStartedAt: sql`COALESCE(${scEmployees.onboardingStartedAt}, NOW())`,
        updatedAt: new Date(),
      })
      .where(eq(scEmployees.id, ctx.employeeId)),
  );

  await logAuditEvent({
    action: "shiftcraft.welcome.personal_saved",
    targetKind: "sc_employee",
    targetId: ctx.employeeId,
  });

  revalidatePath("/app/welcome");
  return { status: "ok", message: "Saved." };
}

// ─── Payroll PII (encrypted) ────────────────────────────────────────

const piiSchema = z.object({
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

export async function selfSavePayrollPiiAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireSelfEmployee();
  if (!ctx) {
    return {
      status: "error",
      message: "You don't have a roster row yet — ask your manager.",
    };
  }
  const parsed = piiSchema.safeParse({
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

  // Normalise spacing/dashes before encrypting so the manager-side
  // reveal returns a canonical form (matches the existing
  // savePayrollPiiAction convention).
  const tfn = emptyToNull(parsed.data.tfn)?.replace(/\s/g, "") ?? null;
  const bsb = emptyToNull(parsed.data.bsb)?.replace(/-/g, "") ?? null;
  const accountNumber = emptyToNull(parsed.data.accountNumber);
  const superFundName = emptyToNull(parsed.data.superFundName);
  const superMemberNumber = emptyToNull(parsed.data.superMemberNumber);

  // The four secret fields render BLANK in the form with a "Leave blank to
  // keep" hint — the ciphertext is never sent to the client, so there's
  // nothing to pre-fill. Honour that promise: only overwrite a secret
  // column when the worker actually typed a new value. Without this, a
  // worker who has a TFN on file and returns to fix only their BSB would
  // silently wipe the TFN / account / super-member-number (all submitted
  // blank). superFundName is the exception — it's rendered pre-filled, so
  // a blank there is a deliberate clear.
  const updateSet: Partial<typeof scEmployees.$inferInsert> = {
    superFundName,
    updatedAt: new Date(),
  };
  if (tfn !== null) updateSet.tfnEnc = encryptPii(tfn);
  if (bsb !== null) updateSet.bsbEnc = encryptPii(bsb);
  if (accountNumber !== null) {
    updateSet.accountNumberEnc = encryptPii(accountNumber);
  }
  if (superMemberNumber !== null) {
    updateSet.superMemberNumberEnc = encryptPii(superMemberNumber);
  }

  await forTenant(ctx.tenantId).run((tx) =>
    tx.update(scEmployees).set(updateSet).where(eq(scEmployees.id, ctx.employeeId)),
  );

  // Audit log records WHICH secret fields were (re)written this save —
  // never the value. superFundName is always part of the write.
  await logAuditEvent({
    action: "shiftcraft.welcome.pii_saved",
    targetKind: "sc_employee",
    targetId: ctx.employeeId,
    details: {
      tfn: tfn !== null,
      bsb: bsb !== null,
      account: accountNumber !== null,
      super: superMemberNumber !== null,
    },
  });

  revalidatePath("/app/welcome");
  return { status: "ok", message: "Payroll details saved." };
}

// ─── Self-service kiosk PIN ─────────────────────────────────────────
//
// Mirrors the manager-only setPinAction (employees/new/actions.ts) but
// scopes the write to the CALLER's own roster row via requireSelfEmployee()
// — ctx.userId is the auth identity, which is exactly the app_user_id the
// kiosk authenticates against and the column sc_employee_pins is keyed on.
// The manager setPinAction stays as the admin override.

const pinSchema = z
  .object({
    pin: z.string().trim().regex(/^\d{4}$/, "PIN must be exactly 4 digits."),
    confirm: z.string().trim(),
  })
  .refine((d) => d.pin === d.confirm, {
    message: "PINs don't match.",
    path: ["confirm"],
  });

export async function selfSetPinAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireSelfEmployee();
  if (!ctx) {
    return {
      status: "error",
      message: "You don't have a roster row yet — ask your manager.",
    };
  }

  const parsed = pinSchema.safeParse({
    pin: formData.get("pin") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.errors[0]?.message ?? "Invalid PIN.",
    };
  }

  // Same collision check as the manager action: PIN uniqueness is NOT
  // enforced at the DB (bcrypt salts each hash), so we catch collisions
  // here so the kiosk can rely on "one PIN matches at most one user".
  // The kiosk surface still returns generic "Wrong PIN" — no enumeration.
  const others = await forTenant(ctx.tenantId).run((tx) =>
    tx
      .select({ pinHash: scEmployeePins.pinHash })
      .from(scEmployeePins)
      .where(
        and(
          eq(scEmployeePins.traceyTenantId, ctx.tenantId),
          sql`${scEmployeePins.appUserId} <> ${ctx.userId}`,
        ),
      ),
  );
  for (const o of others) {
    if (await verifyPassword(parsed.data.pin, o.pinHash)) {
      return {
        status: "error",
        message:
          "That PIN is already in use by another teammate — pick a different one.",
      };
    }
  }

  const me = await currentUser();
  const pinHash = await hashPassword(parsed.data.pin);

  // Upsert — one PIN per (tenant, app_user). On rotate, reset lastUsedAt so
  // the "last used" display isn't tied to the old PIN.
  await forTenant(ctx.tenantId).run((tx) =>
    tx
      .insert(scEmployeePins)
      .values({
        traceyTenantId: ctx.tenantId,
        appUserId: ctx.userId,
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
    action: "shiftcraft.welcome.pin_set",
    targetKind: "sc_employee_pin",
    targetId: ctx.userId,
  });

  revalidatePath("/app/welcome");
  return { status: "ok", message: "Kiosk PIN saved." };
}

// ─── Document self-upload ───────────────────────────────────────────

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB — matches the existing CHECK constraint
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

const uploadSchema = z.object({
  title: z.string().trim().min(1, "Pick a title").max(200),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function selfUploadDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireSelfEmployee();
  if (!ctx) {
    return {
      status: "error",
      message: "You don't have a roster row yet — ask your manager.",
    };
  }

  const parsed = uploadSchema.safeParse({
    title: formData.get("title") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Pick a file to upload." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { status: "error", message: "Max file size is 5 MiB." };
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return {
      status: "error",
      message: "Only PDF / JPEG / PNG / DOC / DOCX are supported.",
    };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  await forTenant(ctx.tenantId).run((tx) =>
    tx.insert(scDocuments).values({
      traceyTenantId: ctx.tenantId,
      scope: "team",
      employeeId: ctx.employeeId,
      title: parsed.data.title,
      notes: emptyToNull(parsed.data.notes),
      mimeType: file.type,
      fileSize: file.size,
      data: bytes,
      uploadedByUserId: ctx.userId,
    }),
  );

  await logAuditEvent({
    action: "shiftcraft.welcome.document_uploaded",
    targetKind: "sc_document",
    details: {
      employeeId: ctx.employeeId,
      title: parsed.data.title,
      mimeType: file.type,
      size: file.size,
    },
  });

  revalidatePath("/app/welcome");
  return { status: "ok", message: "Uploaded." };
}

// ─── Onboarding task self-toggle ────────────────────────────────────

const taskSchema = z.object({
  taskId: z.string().uuid(),
  done: z.enum(["1", "0"]),
});

export async function selfMarkOnboardingTaskAction(
  formData: FormData,
): Promise<void> {
  const ctx = await requireSelfEmployee();
  if (!ctx) return;
  const parsed = taskSchema.safeParse({
    taskId: formData.get("taskId"),
    done: formData.get("done"),
  });
  if (!parsed.success) return;

  // Look up the task; verify it belongs to the caller's employee row.
  const [task] = await forTenant(ctx.tenantId).run((tx) =>
    tx
      .select({
        id: scEmployeeOnboardingTasks.id,
        employeeId: scEmployeeOnboardingTasks.employeeId,
      })
      .from(scEmployeeOnboardingTasks)
      .where(
        and(
          eq(scEmployeeOnboardingTasks.id, parsed.data.taskId),
          eq(scEmployeeOnboardingTasks.traceyTenantId, ctx.tenantId),
        ),
      )
      .limit(1),
  );
  if (!task || task.employeeId !== ctx.employeeId) return;

  const isDone = parsed.data.done === "1";
  await forTenant(ctx.tenantId).run((tx) =>
    tx
      .update(scEmployeeOnboardingTasks)
      .set({
        status: isDone ? "done" : "pending",
        completedAt: isDone ? new Date() : null,
        completedByUserId: isDone ? ctx.userId : null,
      })
      .where(eq(scEmployeeOnboardingTasks.id, task.id)),
  );

  await logAuditEvent({
    action: isDone
      ? "shiftcraft.welcome.task_completed"
      : "shiftcraft.welcome.task_reopened",
    targetKind: "sc_employee_onboarding_task",
    targetId: task.id,
  });
  revalidatePath("/app/welcome");
}

// ─── Complete onboarding — flips status to 'active' ────────────────
//
// Only succeeds when every REQUIRED task is done. Caller doesn't need
// to fill in PII — that's optional. Personal details are also optional
// (the manager can chase them later).

export async function completeOnboardingSelfAction(): Promise<void> {
  const ctx = await requireSelfEmployee();
  if (!ctx) return;

  // Count outstanding required tasks. If any remain, no-op.
  const rows = await forTenant(ctx.tenantId).run((tx) =>
    tx
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(scEmployeeOnboardingTasks)
      .where(
        and(
          eq(scEmployeeOnboardingTasks.traceyTenantId, ctx.tenantId),
          eq(scEmployeeOnboardingTasks.employeeId, ctx.employeeId),
          eq(scEmployeeOnboardingTasks.required, true),
          eq(scEmployeeOnboardingTasks.status, "pending"),
        ),
      ),
  );
  const outstanding = rows[0]?.count ?? 0;
  if (outstanding > 0) return;

  await forTenant(ctx.tenantId).run((tx) =>
    tx
      .update(scEmployees)
      .set({
        onboardingStatus: "active",
        onboardingCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scEmployees.id, ctx.employeeId)),
  );

  await logAuditEvent({
    action: "shiftcraft.welcome.onboarding_completed",
    targetKind: "sc_employee",
    targetId: ctx.employeeId,
  });

  revalidatePath("/app/welcome");
  revalidatePath("/app");
  redirect("/app");
}
