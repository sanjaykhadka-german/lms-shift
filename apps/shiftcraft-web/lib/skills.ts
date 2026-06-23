import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  forTenant,
  scAreas,
  scAreaSkills,
  scEmployees,
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

// ─── Per-area required skills (items 4 & 7) ─────────────────────────

/** Skill IDs required to work in a given area. */
export async function listAreaSkillIds(
  tenantId: string,
  areaId: string,
): Promise<string[]> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ skillId: scAreaSkills.skillId })
      .from(scAreaSkills)
      .where(
        and(
          eq(scAreaSkills.traceyTenantId, tenantId),
          eq(scAreaSkills.areaId, areaId),
        ),
      ),
  );
  return rows.map((r) => r.skillId);
}

export interface AreaTrainingGap {
  areaName: string;
  /** Names of required skills the employee does NOT hold. */
  missing: string[];
}

/**
 * Soft training-gap check for rostering `appUserId` into the area identified
 * by (locationId, role). Returns null — i.e. nothing to warn about — when the
 * area has no required skills, no area row matches, the user isn't a linked
 * employee, or they already hold every required skill. Never blocks; the
 * caller surfaces the gap as a warning the manager can ignore.
 */
export async function findAreaTrainingGap(
  tenantId: string,
  locationId: string | null,
  role: string,
  appUserId: string,
): Promise<AreaTrainingGap | null> {
  if (!locationId) return null;
  return forTenant(tenantId).run(async (tx) => {
    const [area] = await tx
      .select({ id: scAreas.id, name: scAreas.name })
      .from(scAreas)
      .where(
        and(
          eq(scAreas.traceyTenantId, tenantId),
          eq(scAreas.locationId, locationId),
          sql`lower(${scAreas.name}) = lower(${role})`,
        ),
      )
      .limit(1);
    if (!area) return null;

    const required = await tx
      .select({ skillId: scAreaSkills.skillId, name: scSkills.name })
      .from(scAreaSkills)
      .innerJoin(scSkills, eq(scSkills.id, scAreaSkills.skillId))
      .where(
        and(
          eq(scAreaSkills.traceyTenantId, tenantId),
          eq(scAreaSkills.areaId, area.id),
        ),
      );
    if (required.length === 0) return null;

    const [emp] = await tx
      .select({ id: scEmployees.id })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.traceyTenantId, tenantId),
          eq(scEmployees.appUserId, appUserId),
        ),
      )
      .limit(1);
    if (!emp) return null; // not a linked employee — can't assess, don't warn

    const held = new Set(
      (
        await tx
          .select({ skillId: scEmployeeSkills.skillId })
          .from(scEmployeeSkills)
          .where(
            and(
              eq(scEmployeeSkills.traceyTenantId, tenantId),
              eq(scEmployeeSkills.employeeId, emp.id),
            ),
          )
      ).map((r) => r.skillId),
    );

    const missing = required
      .filter((r) => !held.has(r.skillId))
      .map((r) => r.name);
    if (missing.length === 0) return null;
    return { areaName: area.name, missing };
  });
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
