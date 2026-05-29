"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import {
  db,
  forTenant,
  lmsDepartments,
  lmsEmployers,
  lmsMachines,
  lmsPositions,
  lmsUserMachines,
  lmsUsers,
} from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { autoAssignForDepartment } from "~/lib/lms/admin";
import { sendInviteEmail } from "~/lib/lms/notify-admin";
import { normalizeHeader, parseCsv } from "~/lib/lms/csv";
import { tenantWhere } from "~/lib/lms/tenant-scope";

const VALID_ROLES = new Set(["admin", "qaqc", "employee"]);

interface RowError {
  row: number;
  email: string;
  reason: string;
}

interface UploadResult {
  created: number;
  skipped: number;
  invited: number;
  errors: RowError[];
}

const ERROR_CAP = 100;

function parseUserDate(raw: string): string | null {
  // Accept YYYY-MM-DD or DD/MM/YYYY (Flask parse_user_date). Returns
  // ISO date string. Throws on invalid.
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const dd = m[1]!.padStart(2, "0");
    const mm = m[2]!.padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  throw new Error(`bad date '${s}'`);
}

async function getOrCreateDepartment(name: string, tid: string): Promise<number> {
  const trimmed = name.trim();
  return forTenant(tid).run(async (tx) => {
    const existing = await tx
      .select({ id: lmsDepartments.id })
      .from(lmsDepartments)
      .where(and(eq(lmsDepartments.name, trimmed), tenantWhere(lmsDepartments, tid)))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [row] = await tx
      .insert(lmsDepartments)
      .values({ name: trimmed, traceyTenantId: tid })
      .returning({ id: lmsDepartments.id });
    return row!.id;
  });
}

async function getOrCreateEmployer(name: string, tid: string): Promise<number> {
  const trimmed = name.trim();
  return forTenant(tid).run(async (tx) => {
    const existing = await tx
      .select({ id: lmsEmployers.id })
      .from(lmsEmployers)
      .where(and(eq(lmsEmployers.name, trimmed), tenantWhere(lmsEmployers, tid)))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [row] = await tx
      .insert(lmsEmployers)
      .values({ name: trimmed, traceyTenantId: tid })
      .returning({ id: lmsEmployers.id });
    return row!.id;
  });
}

async function getOrCreateMachine(name: string, tid: string): Promise<number> {
  const trimmed = name.trim();
  return forTenant(tid).run(async (tx) => {
    const existing = await tx
      .select({ id: lmsMachines.id })
      .from(lmsMachines)
      .where(and(eq(lmsMachines.name, trimmed), tenantWhere(lmsMachines, tid)))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const [row] = await tx
      .insert(lmsMachines)
      .values({ name: trimmed, traceyTenantId: tid })
      .returning({ id: lmsMachines.id });
    return row!.id;
  });
}

async function findPositionIdByName(name: string, tid: string): Promise<number | null> {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  const all = await forTenant(tid).run((tx) =>
    tx
      .select({ id: lmsPositions.id, name: lmsPositions.name })
      .from(lmsPositions)
      .where(tenantWhere(lmsPositions, tid)),
  );
  const hit = all.find((p) => p.name.toLowerCase() === lower);
  return hit?.id ?? null;
}

export async function bulkUploadEmployeesAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/app/admin/employees/bulk?error=nofile");
  }
  const fileObj = file as File;
  let text: string;
  try {
    text = await fileObj.text();
  } catch {
    redirect("/app/admin/employees/bulk?error=encoding");
  }

  const parsed = parseCsv(text);
  if (parsed.headers.length === 0) {
    redirect("/app/admin/employees/bulk?error=empty");
  }
  const headerLookup = new Map<string, string>();
  for (const h of parsed.headers) {
    headerLookup.set(normalizeHeader(h), h);
  }
  if (!headerLookup.has("email")) {
    redirect("/app/admin/employees/bulk?error=noemail");
  }

  const cell = (row: Record<string, string>, key: string) => {
    const orig = headerLookup.get(key);
    if (!orig) return "";
    return (row[orig] ?? "").trim();
  };

  const result: UploadResult = { created: 0, skipped: 0, invited: 0, errors: [] };
  const seenEmails = new Set<string>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]!;
    const lineNumber = i + 2; // header is line 1
    const reject = (reason: string, email: string) => {
      result.skipped += 1;
      if (result.errors.length < ERROR_CAP) {
        result.errors.push({ row: lineNumber, email: email || "(blank)", reason });
      }
    };

    const email = cell(row, "email").toLowerCase();
    let firstName = cell(row, "first name");
    let lastName = cell(row, "last name");
    if (!firstName && !lastName) {
      const legacy = cell(row, "name");
      if (legacy) {
        const parts = legacy.split(/\s+/, 2);
        firstName = parts[0] ?? "";
        lastName = parts[1] ?? "";
      }
    }
    const phone = cell(row, "phone");
    const deptName = cell(row, "department");
    const employerName = cell(row, "employer");
    const startRaw = cell(row, "start date");
    const termRaw = cell(row, "termination date");
    const jobTitle = cell(row, "job title");
    const positionName = cell(row, "position");
    const machinesRaw = cell(row, "machines");
    let role = cell(row, "role").toLowerCase() || "employee";
    if (!VALID_ROLES.has(role)) role = "employee";
    // Tracey admins (not owners) cannot mass-create LMS admins via CSV.
    if (role === "admin" && ctx.role !== "owner") role = "employee";

    if (!email) {
      reject("Email is missing", email);
      continue;
    }
    if (!email.includes("@")) {
      reject("Email looks wrong (no @ sign)", email);
      continue;
    }
    if (!firstName) {
      reject("First Name is missing", email);
      continue;
    }
    if (!lastName) {
      reject("Last Name is missing", email);
      continue;
    }
    if (!phone) {
      reject("Phone is missing", email);
      continue;
    }
    if (!deptName) {
      reject("Department is missing", email);
      continue;
    }
    if (!employerName) {
      reject("Employer is missing", email);
      continue;
    }
    if (seenEmails.has(email)) {
      reject("This email appears more than once in the CSV", email);
      continue;
    }
    // users.email is globally unique; reject any prior occurrence regardless
    // of tenant (cross-tenant collisions become "already used elsewhere").
    // allow-cross-tenant: public.users excluded from RLS; cross-tenant email
    // lookup is intentional (deliberately spans tenants).
    const dupe = await db
      .select({ id: lmsUsers.id, traceyTenantId: lmsUsers.traceyTenantId })
      .from(lmsUsers)
      .where(eq(lmsUsers.email, email))
      .limit(1);
    if (dupe[0]) {
      const reason =
        dupe[0].traceyTenantId !== tid
          ? "This email belongs to a user in another workspace"
          : "This email is already in the system";
      reject(reason, email);
      seenEmails.add(email);
      continue;
    }
    let startDate: string | null = null;
    let termDate: string | null = null;
    try {
      startDate = parseUserDate(startRaw);
      termDate = parseUserDate(termRaw);
    } catch (err) {
      reject(
        `Date format wrong (${(err as Error).message}). Use YYYY-MM-DD or DD/MM/YYYY.`,
        email,
      );
      continue;
    }

    const departmentId = await getOrCreateDepartment(deptName, tid);
    const employerId = await getOrCreateEmployer(employerName, tid);

    const machineNames = machinesRaw
      .replace(/\|/g, ",")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const machineIds: number[] = [];
    for (const m of machineNames) {
      machineIds.push(await getOrCreateMachine(m, tid));
    }

    const positionId = positionName ? await findPositionIdByName(positionName, tid) : null;
    const fullName = `${firstName} ${lastName}`.trim();
    const tempPw = crypto.randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(tempPw, 12);

    let newId: number | undefined;
    try {
      const [inserted] = await ctx.db.run((tx) =>
        tx
          .insert(lmsUsers)
          .values({
            email,
            name: fullName,
            firstName,
            lastName,
            passwordHash,
            role,
            isActiveFlag: true,
            phone,
            departmentId,
            employerId,
            startDate,
            terminationDate: termDate,
            jobTitle,
            positionId,
            traceyTenantId: tid,
          })
          .returning({ id: lmsUsers.id }),
      );
      newId = inserted?.id;
    } catch {
      reject("This email is already in the system", email);
      seenEmails.add(email);
      continue;
    }
    seenEmails.add(email);

    if (newId && machineIds.length > 0) {
      await ctx.db.run((tx) =>
        tx.insert(lmsUserMachines).values(
          machineIds.map((machineId) => ({ userId: newId!, machineId, traceyTenantId: tid })),
        ),
      );
    }

    const emailed = await sendInviteEmail({
      to: email,
      name: fullName,
      tempPassword: tempPw,
    });
    if (emailed) result.invited += 1;
    if (newId) {
      await autoAssignForDepartment({
        userId: newId,
        departmentId,
        traceyTenantId: tid,
        tenantTimezone: ctx.tenantTimezone,
      });
    }
    result.created += 1;
  }

  if (result.created > 0) {
    await logAuditEvent({
      tenantId: tid,
      actorUserId: ctx.traceyUserId,
      actorEmail: ctx.lmsUser.email,
      action: "employee.bulk_imported",
      targetKind: "user",
      details: {
        created: result.created,
        skipped: result.skipped,
        invited: result.invited,
      },
    });
  }
  revalidatePath("/app/admin/employees");

  // Surface results via search params on the bulk page (and stash error
  // details in a flash cookie to avoid a giant URL).
  const cookieStore = await import("next/headers").then((m) => m.cookies());
  cookieStore.set(
    "tracey.bulkErrors",
    JSON.stringify({ errors: result.errors }),
    { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 5 },
  );
  redirect(
    `/app/admin/employees/bulk?ok=1&created=${result.created}&skipped=${result.skipped}&invited=${result.invited}`,
  );
}
