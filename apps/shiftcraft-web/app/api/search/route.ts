import { NextResponse } from "next/server";
import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  forTenant,
  scEmployees,
  scLocations,
  scShiftTemplates,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { getManagedLocationIds, scopeArray } from "~/lib/manager-scope";
import { NAV_MODULES } from "~/lib/nav-modules";

const ENTITY_LIMIT = 6;
const MODULE_LIMIT = 8;

type ModuleHit = { id: string; title: string; url: string };
type EmployeeHit = { id: string; name: string; email: string | null; url: string };
type LookupHit = { id: string; name: string; url: string };

const EMPTY_BODY = {
  modules: [] as ModuleHit[],
  employees: [] as EmployeeHit[],
  locations: [] as LookupHit[],
  templates: [] as LookupHit[],
};

// GET /api/search?q=<term>
// Universal search across nav modules + people + places. Modules are visible
// to everyone (filtered by the same admin gate as the sidebar); employees,
// locations, and shift templates are manager-tier and respect the caller's
// location scope (a Location Manager only sees their sites).
export async function GET(req: Request) {
  const [user, membership] = await Promise.all([currentUser(), currentMembership()]);
  if (!user || !membership) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json(EMPTY_BODY);
  }

  const role = membership.role;
  const tenantId = membership.tenant.id;
  const manager = isAtLeastManager(role);
  const lower = q.toLowerCase();
  const like = `%${q}%`;

  // Modules — static nav list, filtered by the admin gate. Substring match on
  // the label so "time" surfaces "Time clock" + "Time off".
  const modules: ModuleHit[] = NAV_MODULES.filter(
    (m) => (!m.adminOnly || manager) && m.label.toLowerCase().includes(lower),
  )
    .slice(0, MODULE_LIMIT)
    .map((m) => ({ id: m.href, title: m.label, url: m.href }));

  if (!manager) {
    // Members get module navigation only — no roster/people lookups.
    return NextResponse.json({ ...EMPTY_BODY, modules });
  }

  // Location scope: null = all locations (owner / unscoped admin), otherwise a
  // bounded list. Use inArray() — raw `= ANY($array)` throws "malformed array
  // literal" under postgres-js (see feedback_drizzle_any_array_bug).
  const scope = scopeArray(await getManagedLocationIds(tenantId, user.id, role));
  const tdb = forTenant(tenantId);

  const [employeeRows, locationRows, templateRows] = await Promise.all([
    tdb.run((tx) =>
      tx
        .select({
          id: scEmployees.id,
          name: scEmployees.fullName,
          email: scEmployees.email,
        })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            scope ? inArray(scEmployees.locationId, scope) : undefined,
            or(
              ilike(scEmployees.fullName, like),
              ilike(scEmployees.email, like),
              ilike(scEmployees.position, like),
            ),
          ),
        )
        .orderBy(asc(scEmployees.fullName))
        .limit(ENTITY_LIMIT),
    ),
    tdb.run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name })
        .from(scLocations)
        .where(
          and(
            eq(scLocations.traceyTenantId, tenantId),
            scope ? inArray(scLocations.id, scope) : undefined,
            ilike(scLocations.name, like),
          ),
        )
        .orderBy(asc(scLocations.name))
        .limit(ENTITY_LIMIT),
    ),
    tdb.run((tx) =>
      tx
        .select({ id: scShiftTemplates.id, name: scShiftTemplates.name })
        .from(scShiftTemplates)
        .where(
          and(
            eq(scShiftTemplates.traceyTenantId, tenantId),
            scope ? inArray(scShiftTemplates.locationId, scope) : undefined,
            ilike(scShiftTemplates.name, like),
          ),
        )
        .orderBy(asc(scShiftTemplates.name))
        .limit(ENTITY_LIMIT),
    ),
  ]);

  return NextResponse.json({
    modules,
    employees: employeeRows.map((e) => ({
      id: e.id,
      name: e.name,
      email: e.email,
      url: `/app/employees/${e.id}/edit`,
    })),
    locations: locationRows.map((l) => ({
      id: l.id,
      name: l.name,
      url: "/app/locations",
    })),
    templates: templateRows.map((t) => ({
      id: t.id,
      name: t.name,
      url: "/app/shift-templates",
    })),
  });
}
