"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scDocuments, scEmployees } from "@tracey/db";
import { encryptPii } from "@tracey/db/pii";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { isAtLeastManager } from "~/lib/roles";

// ─────────────────────────────────────────────────────────────────────────────
// Employee onboarding — the "Deputy-style" self-service submission.
//
// Mirrors the conventions in app/app/employees/new/actions.ts:
//   • Zod safeParse → discriminated-union FormState with fieldErrors
//   • forTenant(tenantId).run(tx => …) for every per-tenant query
//   • encryptPii() for TFN / BSB / account number / super member number
//   • logAuditEvent() with field NAMES only (never plaintext PII)
//
// Required-field policy deliberately *stricter* than Deputy's: the Deputy
// export we reviewed completed with First name, Last name and Mobile blank
// and an emergency-contact relationship that held a phone number. Here those
// are mandatory and validated (relationship is text, not a phone field).
//
// All form sections persist to sc_employees, including the four columns added
// by migration 0058 (per-tenant) / migrate-shiftcraft 0045 (public template):
//   emergency_contact_relationship, bank_account_name,
//   tfn_declaration (jsonb), work_eligibility (jsonb).
// They are captured + validated here, assembled into `meta`, and written below.
//
// Document uploads (Passport / Visa / Licence / extras) post separately to
// uploadOnboardingDocumentAction — they can't ride the main submit because the
// server-action body is capped at 5 MB total, and the shared
// uploadDocumentAction is manager-only (onboarding is self-service).
// ─────────────────────────────────────────────────────────────────────────────

export type EmployeeOnboardingState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

const yesNo = z.enum(["yes", "no"]);

const schema = z
  .object({
    // ── Personal details ──
    fullName: z.string().trim().min(1, "Full legal name is required").max(120),
    preferredName: z.string().trim().max(120).optional().or(z.literal("")),
    dateOfBirth: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth is required (YYYY-MM-DD)"),
    gender: z
      .union([
        z.literal(""),
        z.enum(["female", "male", "non_binary", "prefer_not_to_say"]),
      ])
      .optional(),
    email: z.string().trim().email("A valid email is required"),
    mobile: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{8,20}$/, "A valid mobile number is required"),
    addressLine: z.string().trim().min(1, "Residential address is required").max(300),
    emergencyContactName: z
      .string()
      .trim()
      .min(1, "Emergency contact name is required")
      .max(120),
    emergencyContactPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{8,20}$/, "A valid emergency contact number is required"),
    emergencyContactRelationship: z
      .string()
      .trim()
      .min(2, "Relationship is required (e.g. Spouse, Parent)")
      .max(60)
      .regex(/[A-Za-z]/, "Enter a relationship, not a phone number"),

    // ── Bank details ──
    bankAccountName: z.string().trim().min(1, "Account name is required").max(120),
    bsb: z.string().trim().regex(/^\d{3}-?\d{3}$/, "BSB is 6 digits (xxx-xxx)"),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{4,12}$/, "Account number is 4-12 digits"),

    // ── TFN declaration ──
    hasTfn: yesNo,
    tfn: z
      .union([
        z.literal(""),
        z.string().trim().regex(/^\d{3}\s?\d{3}\s?\d{2,3}$/, "TFN is 8-9 digits"),
      ])
      .optional(),
    residency: z.enum(["resident", "foreign", "working_holiday"], {
      errorMap: () => ({ message: "Select your residency status" }),
    }),
    payBasis: z.enum(["full_time", "part_time", "casual", "labour_hire"], {
      errorMap: () => ({ message: "Select how you are paid" }),
    }),
    claimTaxFreeThreshold: yesNo,
    hasStudyLoan: yesNo,
    declarationTrue: z.literal("on", {
      errorMap: () => ({ message: "You must declare the information is true" }),
    }),

    // ── Superannuation ──
    superEligible: yesNo,
    superChoice: z.enum(["own", "employer_default"]).optional(),
    superFundName: z.string().trim().max(120).optional().or(z.literal("")),
    superMemberNumber: z
      .union([z.literal(""), z.string().trim().min(2).max(40)])
      .optional(),

    // ── Additional questions ──
    workVisa: z.enum(["yes_attached", "no", "citizen_or_pr"], {
      errorMap: () => ({ message: "Answer the work-eligibility question" }),
    }),
  })
  // TFN must be supplied unless the employee explicitly has none.
  .refine((d) => d.hasTfn === "no" || (d.tfn ?? "") !== "", {
    path: ["tfn"],
    message: "Enter your TFN, or select that you don't have one",
  })
  // If choosing their own fund, the fund name + member number are required.
  .refine(
    (d) => d.superChoice !== "own" || (d.superFundName ?? "") !== "",
    { path: ["superFundName"], message: "Fund name is required for your own fund" },
  )
  .refine(
    (d) => d.superChoice !== "own" || (d.superMemberNumber ?? "") !== "",
    { path: ["superMemberNumber"], message: "Member number is required for your own fund" },
  );

function emptyToNull(v: string | undefined | null): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

export async function submitEmployeeOnboardingAction(
  employeeId: string,
  _prev: EmployeeOnboardingState,
  formData: FormData,
): Promise<EmployeeOnboardingState> {
  const membership = await currentMembership();
  if (!membership) {
    return { status: "error", message: "Please sign in to continue." };
  }
  const tenantId = membership.tenant.id;

  const parsed = schema.safeParse({
    fullName: formData.get("fullName") ?? "",
    preferredName: formData.get("preferredName") ?? "",
    dateOfBirth: formData.get("dateOfBirth") ?? "",
    gender: formData.get("gender") ?? "",
    email: formData.get("email") ?? "",
    mobile: formData.get("mobile") ?? "",
    addressLine: formData.get("addressLine") ?? "",
    emergencyContactName: formData.get("emergencyContactName") ?? "",
    emergencyContactPhone: formData.get("emergencyContactPhone") ?? "",
    emergencyContactRelationship: formData.get("emergencyContactRelationship") ?? "",
    bankAccountName: formData.get("bankAccountName") ?? "",
    bsb: formData.get("bsb") ?? "",
    accountNumber: formData.get("accountNumber") ?? "",
    hasTfn: formData.get("hasTfn") ?? "yes",
    tfn: formData.get("tfn") ?? "",
    residency: formData.get("residency") ?? "",
    payBasis: formData.get("payBasis") ?? "",
    claimTaxFreeThreshold: formData.get("claimTaxFreeThreshold") ?? "no",
    hasStudyLoan: formData.get("hasStudyLoan") ?? "no",
    declarationTrue: formData.get("declarationTrue") ?? "",
    superEligible: formData.get("superEligible") ?? "yes",
    superChoice: formData.get("superChoice") ?? "own",
    superFundName: formData.get("superFundName") ?? "",
    superMemberNumber: formData.get("superMemberNumber") ?? "",
    workVisa: formData.get("workVisa") ?? "",
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  // Authorisation: the employee themselves, or any manager/owner. Mirrors the
  // permission posture of savePayrollPiiAction (manager+) but also lets the
  // person whose record this is complete their own onboarding.
  const user = await currentUser();
  const [target] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scEmployees.id, appUserId: scEmployees.appUserId })
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
  const isSelf = !!user && !!target.appUserId && target.appUserId === user.id;
  if (!isSelf && !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "You don't have permission to complete this onboarding.",
    };
  }

  // Normalise before encrypting so reveals come back in one canonical form.
  const tfn = d.hasTfn === "no" ? null : emptyToNull(d.tfn)?.replace(/\s/g, "") ?? null;
  const bsb = emptyToNull(d.bsb)?.replace(/-/g, "") ?? null;
  const accountNumber = emptyToNull(d.accountNumber);
  const superFundName = d.superChoice === "own" ? emptyToNull(d.superFundName) : null;
  const superMemberNumber =
    d.superChoice === "own" ? emptyToNull(d.superMemberNumber) : null;

  // The four fields awaiting a column (see header note + ONBOARDING-MIGRATION.md).
  const meta = {
    emergencyContactRelationship: d.emergencyContactRelationship,
    bankAccountName: d.bankAccountName,
    tfnDeclaration: {
      residency: d.residency,
      payBasis: d.payBasis,
      claimTaxFreeThreshold: d.claimTaxFreeThreshold === "yes",
      hasStudyLoan: d.hasStudyLoan === "yes",
      declaredTrueAt: new Date().toISOString(),
    },
    workEligibility: { workVisa: d.workVisa, superEligible: d.superEligible === "yes" },
  };

  await forTenant(tenantId).run((tx) =>
    tx
      .update(scEmployees)
      .set({
        fullName: d.fullName,
        preferredName: emptyToNull(d.preferredName),
        dateOfBirth: d.dateOfBirth,
        gender: emptyToNull(d.gender) as
          | "female"
          | "male"
          | "non_binary"
          | "prefer_not_to_say"
          | null,
        email: d.email,
        mobile: d.mobile,
        addressLine: d.addressLine,
        emergencyContactName: d.emergencyContactName,
        emergencyContactPhone: d.emergencyContactPhone,
        emergencyContactRelationship: meta.emergencyContactRelationship,
        bankAccountName: meta.bankAccountName,
        tfnEnc: encryptPii(tfn),
        bsbEnc: encryptPii(bsb),
        accountNumberEnc: encryptPii(accountNumber),
        superFundName,
        superMemberNumberEnc: encryptPii(superMemberNumber),
        tfnDeclaration: meta.tfnDeclaration,
        workEligibility: meta.workEligibility,
        onboardingStatus: "active",
        onboardingCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scEmployees.id, employeeId),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.employee.onboarding_submitted",
    targetKind: "sc_employee",
    targetId: employeeId,
    details: {
      // Field names + set/cleared only — never the plaintext values.
      personal: "set",
      bank: { bsb: bsb ? "set" : "cleared", accountNumber: accountNumber ? "set" : "cleared" },
      tfn: tfn ? "set" : "none",
      super: { fundName: superFundName ? "set" : "cleared", choice: d.superChoice },
      workVisa: d.workVisa,
      submittedBy: isSelf ? "self" : "manager",
    },
  });

  revalidatePath(`/app/people/onboarding/${employeeId}`);
  revalidatePath("/app/people/onboarding");
  return { status: "ok", message: "Onboarding submitted. Thank you!" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding document upload — self-service.
//
// The shared uploadDocumentAction (app/app/people/documents/_actions.ts) is
// Manager+ only, but onboarding is self-service, so the new hire uploading their
// own ID / visa / licence needs a self-or-manager path. Each file posts here
// individually (its own request → its own 5 MB body budget) rather than riding
// the main onboarding submit, which is capped at 5 MB total.
//
// The limits below mirror uploadDocumentAction. They're re-declared (not
// imported) because that file is a "use server" module and Next 16's strict
// rule forbids exporting non-async-function values from it.
// ─────────────────────────────────────────────────────────────────────────────

// 5 MiB — matches the CHECK on sc_documents.file_size and the
// experimental.serverActions.bodySizeLimit in next.config.ts.
const DOC_MAX_BYTES = 5 * 1024 * 1024;

// Per-tenant total cap on bytea storage (Render free Postgres is 1 GB shared
// across all tenants in this DB). Mirrors uploadDocumentAction.
const DOC_TENANT_STORAGE_CAP_BYTES = 500 * 1024 * 1024;

const DOC_ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type OnboardingDocumentState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

const onboardingDocSchema = z.object({
  title: z.string().trim().min(1, "Give the document a name").max(200),
});

export async function uploadOnboardingDocumentAction(
  employeeId: string,
  _prev: OnboardingDocumentState,
  formData: FormData,
): Promise<OnboardingDocumentState> {
  const membership = await currentMembership();
  if (!membership) {
    return { status: "error", message: "Please sign in to continue." };
  }
  const tenantId = membership.tenant.id;

  const parsed = onboardingDocSchema.safeParse({
    title: formData.get("title") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Authorisation: the employee themselves, or any manager/owner — identical
  // posture to submitEmployeeOnboardingAction above.
  const user = await currentUser();
  const [target] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scEmployees.id, appUserId: scEmployees.appUserId })
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
  const isSelf = !!user && !!target.appUserId && target.appUserId === user.id;
  if (!isSelf && !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "You don't have permission to upload documents here.",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "error",
      message: "Pick a file to upload.",
      fieldErrors: { file: ["File is required."] },
    };
  }
  if (file.size > DOC_MAX_BYTES) {
    return {
      status: "error",
      message: `File is too large (max ${Math.floor(DOC_MAX_BYTES / 1024 / 1024)} MB).`,
      fieldErrors: { file: ["File exceeds 5 MB."] },
    };
  }
  if (!DOC_ALLOWED_MIMES.has(file.type)) {
    return {
      status: "error",
      message:
        "Unsupported file type. Allowed: PDF, JPG, PNG, WebP, DOC, DOCX, TXT.",
      fieldErrors: { file: [`MIME type ${file.type || "unknown"} not allowed.`] },
    };
  }

  // Per-tenant storage cap — bytea fills Render's Postgres disk fast.
  const totalRow = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        total: sql<number>`coalesce(sum(${scDocuments.fileSize}), 0)::bigint`,
      })
      .from(scDocuments),
  );
  const usedBytes = Number(totalRow[0]?.total ?? 0);
  if (usedBytes + file.size > DOC_TENANT_STORAGE_CAP_BYTES) {
    const remaining = Math.max(0, DOC_TENANT_STORAGE_CAP_BYTES - usedBytes);
    return {
      status: "error",
      message: `Workspace storage cap reached (${fmtMB(usedBytes)} of ${fmtMB(DOC_TENANT_STORAGE_CAP_BYTES)} used; ${fmtMB(remaining)} remaining). Ask an admin to free up space.`,
      fieldErrors: {
        file: [`Not enough storage for ${fmtMB(file.size)}; ${fmtMB(remaining)} left.`],
      },
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const [inserted] = await forTenant(tenantId).run((tx) =>
    tx
      .insert(scDocuments)
      .values({
        traceyTenantId: tenantId,
        scope: "team",
        employeeId,
        title: parsed.data.title,
        notes: null,
        mimeType: file.type,
        fileSize: file.size,
        data: buffer,
        uploadedByUserId: user?.id ?? null,
        expiresAt: null,
        requiresSignature: false,
      })
      .returning({ id: scDocuments.id }),
  );

  await logAuditEvent({
    action: "shiftcraft.document.uploaded",
    targetKind: "sc_document",
    targetId: inserted?.id ?? null,
    details: {
      scope: "team",
      title: parsed.data.title,
      mimeType: file.type,
      fileSize: file.size,
      employeeId,
      requiresSignature: false,
      source: "onboarding",
      uploadedBy: isSelf ? "self" : "manager",
    },
  });

  revalidatePath(`/app/people/onboarding/${employeeId}/complete`);
  revalidatePath("/app/people/team-documents");
  revalidatePath("/app/people/documents");
  return { status: "ok", message: `Uploaded "${parsed.data.title}".` };
}
