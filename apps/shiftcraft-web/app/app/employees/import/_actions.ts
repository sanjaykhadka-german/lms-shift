"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scDepartments,
  scEmployees,
  users,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";

// Bulk CSV employee import. Single-step:
//   1. Manager uploads a CSV.
//   2. Server parses, validates each row, dedups against existing emails,
//      inserts everything that survives in one tenant transaction.
//   3. Returns counts + the per-row outcomes so the page can show what
//      worked and what was skipped.
//
// Expected header (case-insensitive, order flexible):
//   fullName, email, mobile, department, employmentType, hourlyRate
//
// fullName is required; everything else is optional. employmentType
// defaults to 'permanent' and must be one of permanent/casual/labour_hire.
// Rows missing fullName or with an invalid employmentType skip with a
// reason. Duplicate emails (already on the roster) skip with a reason.

const ALLOWED_EMPLOYMENT = new Set([
  "permanent",
  "casual",
  "labour_hire",
]);

export interface ImportRowOutcome {
  rowNumber: number;
  email: string | null;
  fullName: string | null;
  status: "created" | "skipped" | "errored";
  reason?: string;
}

export type ImportState =
  | { status: "idle" }
  | {
      status: "ok";
      createdCount: number;
      skippedCount: number;
      erroredCount: number;
      outcomes: ImportRowOutcome[];
    }
  | { status: "error"; message: string };

// Minimal CSV parser. Splits on commas, handles double-quoted fields
// that contain commas or quotes. Doesn't try to be clever about
// multi-line quoted values — the import format is single-line per row.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += c;
        }
      } else if (c === ",") {
        fields.push(cur);
        cur = "";
      } else if (c === '"' && cur === "") {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
    fields.push(cur);
    rows.push(fields.map((f) => f.trim()));
  }
  return rows;
}

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_-]+/g, "");
}

const COL_ALIASES: Record<string, string> = {
  fullname: "fullName",
  name: "fullName",
  email: "email",
  mobile: "mobile",
  phone: "mobile",
  department: "department",
  dept: "department",
  employmenttype: "employmentType",
  type: "employmentType",
  hourlyrate: "hourlyRate",
  rate: "hourlyRate",
};

async function resolveOrCreateDepartmentId(
  tx: Parameters<Parameters<ReturnType<typeof forTenant>["run"]>[0]>[0],
  tenantId: string,
  name: string,
  cache: Map<string, string>,
): Promise<string | null> {
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
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
  if (existing[0]) {
    cache.set(key, existing[0].id);
    return existing[0].id;
  }
  const inserted = await tx
    .insert(scDepartments)
    .values({ traceyTenantId: tenantId, name })
    .returning({ id: scDepartments.id });
  const id = inserted[0]?.id ?? null;
  if (id) cache.set(key, id);
  return id;
}

export async function importEmployeesAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "Only Managers and Admins can import employees.",
    };
  }
  const tenantId = membership.tenant.id;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Pick a CSV file to import." };
  }
  if (file.size > 2 * 1024 * 1024) {
    return {
      status: "error",
      message: "CSV file is too large (max 2 MB).",
    };
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return {
      status: "error",
      message: "CSV needs a header row plus at least one data row.",
    };
  }

  // Build column-index map from header row.
  const header = rows[0]!.map((h) => COL_ALIASES[normaliseHeader(h)] ?? "");
  const idxOf = (name: string) => header.indexOf(name);
  if (idxOf("fullName") === -1) {
    return {
      status: "error",
      message:
        "CSV header must include 'fullName' (or 'name'). Optional columns: email, mobile, department, employmentType, hourlyRate.",
    };
  }

  // Pull existing emails so we can mark duplicates upfront (one query,
  // not one-per-row).
  const existingEmails = new Set<string>();
  const existingRows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ email: scEmployees.email })
      .from(scEmployees)
      .where(eq(scEmployees.traceyTenantId, tenantId)),
  );
  for (const r of existingRows) {
    if (r.email) existingEmails.add(r.email.toLowerCase());
  }

  // Also build a map of email -> auth user id so we can auto-link
  // imported rows whose email matches an existing tenant member.
  const memberByEmail = new Map<string, string>();
  const memberLookup = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(members, eq(members.userId, users.id))
    .where(eq(members.tenantId, tenantId));
  for (const m of memberLookup) {
    memberByEmail.set(m.email.toLowerCase(), m.id);
  }

  const outcomes: ImportRowOutcome[] = [];
  let createdCount = 0;
  let skippedCount = 0;
  let erroredCount = 0;

  await forTenant(tenantId).run(async (tx) => {
    const deptCache = new Map<string, string>();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNumber = i + 1;
      const fullName = (row[idxOf("fullName")] ?? "").trim();
      const emailRaw =
        idxOf("email") >= 0 ? (row[idxOf("email")] ?? "").trim() : "";
      const email = emailRaw === "" ? null : emailRaw.toLowerCase();
      const mobile =
        idxOf("mobile") >= 0 ? (row[idxOf("mobile")] ?? "").trim() : "";
      const department =
        idxOf("department") >= 0
          ? (row[idxOf("department")] ?? "").trim()
          : "";
      const employmentTypeRaw =
        idxOf("employmentType") >= 0
          ? (row[idxOf("employmentType")] ?? "").trim().toLowerCase()
          : "permanent";
      const hourlyRateRaw =
        idxOf("hourlyRate") >= 0
          ? (row[idxOf("hourlyRate")] ?? "").trim()
          : "";

      if (fullName === "") {
        erroredCount += 1;
        outcomes.push({
          rowNumber,
          email,
          fullName: null,
          status: "errored",
          reason: "Missing fullName",
        });
        continue;
      }
      const employmentType =
        employmentTypeRaw === "" ? "permanent" : employmentTypeRaw;
      if (!ALLOWED_EMPLOYMENT.has(employmentType)) {
        erroredCount += 1;
        outcomes.push({
          rowNumber,
          email,
          fullName,
          status: "errored",
          reason: `Invalid employmentType '${employmentTypeRaw}' (allowed: permanent, casual, labour_hire)`,
        });
        continue;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        erroredCount += 1;
        outcomes.push({
          rowNumber,
          email,
          fullName,
          status: "errored",
          reason: "Invalid email format",
        });
        continue;
      }
      if (email && existingEmails.has(email)) {
        skippedCount += 1;
        outcomes.push({
          rowNumber,
          email,
          fullName,
          status: "skipped",
          reason: "Email already on roster",
        });
        continue;
      }
      if (hourlyRateRaw && !/^\d{1,7}(\.\d{1,2})?$/.test(hourlyRateRaw)) {
        erroredCount += 1;
        outcomes.push({
          rowNumber,
          email,
          fullName,
          status: "errored",
          reason: `Invalid hourlyRate '${hourlyRateRaw}' (e.g. 24.50)`,
        });
        continue;
      }

      const departmentId =
        department === ""
          ? null
          : await resolveOrCreateDepartmentId(tx, tenantId, department, deptCache);
      const linkedAppUserId = email
        ? memberByEmail.get(email) ?? null
        : null;

      try {
        await tx.insert(scEmployees).values({
          traceyTenantId: tenantId,
          fullName,
          email,
          mobile: mobile === "" ? null : mobile,
          departmentId,
          employmentType: employmentType as
            | "permanent"
            | "casual"
            | "labour_hire",
          hourlyRate: hourlyRateRaw === "" ? null : hourlyRateRaw,
          appUserId: linkedAppUserId,
          createdByUserId: me.id,
        });
        if (email) existingEmails.add(email);
        createdCount += 1;
        outcomes.push({
          rowNumber,
          email,
          fullName,
          status: "created",
        });
      } catch (err) {
        const msg =
          (err as { message?: string })?.message ?? "Insert failed";
        erroredCount += 1;
        outcomes.push({
          rowNumber,
          email,
          fullName,
          status: "errored",
          reason: msg.includes("sc_employees_tenant_email_uq")
            ? "Email already on roster (race)"
            : "Insert failed",
        });
      }
    }
  });

  await logAuditEvent({
    action: "shiftcraft.employee.bulk_imported",
    targetKind: "sc_employee",
    targetId: null,
    details: {
      createdCount,
      skippedCount,
      erroredCount,
      totalRows: rows.length - 1,
    },
  });

  revalidatePath("/app/employees");
  revalidatePath("/app/people/team");

  return {
    status: "ok",
    createdCount,
    skippedCount,
    erroredCount,
    outcomes,
  };
}
