import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  forTenant,
  scEmployeeSkills,
  scSkills,
  type ScSkill,
} from "@tracey/db";

// ─── Skills lookups (AUDIT.md #8) ───────────────────────────────────
//
// Per-tenant catalogue + many-to-many to sc_employees. The auto-
// scheduler hydrates a Set<string> of skill IDs per candidate from
// listEmployeeSkillMap; the admin UI lists / mutates the catalogue.

export interface SkillRow {
  id: string;
  name: string;
  slug: string;
  isArchived: boolean;
}

export async function listActiveSkills(
  tenantId: string,
): Promise<SkillRow[]> {
  return forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scSkills.id,
        name: scSkills.name,
        slug: scSkills.slug,
        isArchived: scSkills.isArchived,
      })
      .from(scSkills)
      .where(
        and(
          eq(scSkills.traceyTenantId, tenantId),
          eq(scSkills.isArchived, false),
        ),
      )
      .orderBy(asc(scSkills.name)),
  );
}

export async function listAllSkills(tenantId: string): Promise<ScSkill[]> {
  return forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scSkills)
      .where(eq(scSkills.traceyTenantId, tenantId))
      .orderBy(asc(scSkills.isArchived), asc(scSkills.name)),
  );
}

/**
 * Build a Map<employeeId, Set<skillId>> for the auto-scheduler's
 * candidate hydration. Returns empty map when the employee list is
 * empty so the caller doesn't pay a round trip for nothing.
 */
export async function listEmployeeSkillMap(
  tenantId: string,
  employeeIds: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (employeeIds.length === 0) return out;
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        employeeId: scEmployeeSkills.employeeId,
        skillId: scEmployeeSkills.skillId,
      })
      .from(scEmployeeSkills)
      .where(
        and(
          eq(scEmployeeSkills.traceyTenantId, tenantId),
          inArray(scEmployeeSkills.employeeId, employeeIds),
        ),
      ),
  );
  for (const r of rows) {
    const set = out.get(r.employeeId) ?? new Set<string>();
    set.add(r.skillId);
    out.set(r.employeeId, set);
  }
  return out;
}

export async function listSkillsForEmployee(
  tenantId: string,
  employeeId: string,
): Promise<string[]> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ skillId: scEmployeeSkills.skillId })
      .from(scEmployeeSkills)
      .where(
        and(
          eq(scEmployeeSkills.traceyTenantId, tenantId),
          eq(scEmployeeSkills.employeeId, employeeId),
        ),
      ),
  );
  return rows.map((r) => r.skillId);
}

// Same shape as deriveSlugFromName in leave-types.ts. Duplicated
// rather than extracted into a generic helper so each catalogue's
// slug rules stay local — they could diverge later (e.g. skills
// allowing a different charset).
export function deriveSlugFromName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned.length < 2 || !/^[a-z]/.test(cleaned)) {
    return `skill_${Math.random().toString(36).slice(2, 8)}`;
  }
  return cleaned.slice(0, 40);
}

export async function isSkillReferenced(
  tenantId: string,
  skillId: string,
): Promise<boolean> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx.execute(
      sql`SELECT 1 AS one FROM sc_employee_skills WHERE tracey_tenant_id = ${tenantId} AND skill_id = ${skillId} LIMIT 1`,
    ),
  );
  if (row) return true;
  const [row2] = await forTenant(tenantId).run((tx) =>
    tx.execute(
      sql`SELECT 1 AS one FROM sc_shifts WHERE tracey_tenant_id = ${tenantId} AND required_skill_id = ${skillId} LIMIT 1`,
    ),
  );
  return !!row2;
}
