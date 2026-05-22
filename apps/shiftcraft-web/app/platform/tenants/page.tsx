import Link from "next/link";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scClockEvents,
  scEmployees,
  scKioskDevices,
  scLocations,
  tenants,
  users,
} from "@tracey/db";

export const metadata = { title: "Tenants · Platform" };
export const dynamic = "force-dynamic";

interface ShiftcraftCounts {
  locations: number;
  employees: number;
  activeKiosks: number;
  punchesLast7d: number;
}

/**
 * Per-tenant ShiftCraft stats. Runs inside forTenant(tid).run so the
 * RLS GUC is set + search_path resolves unqualified sc_* names to the
 * per-tenant schema. Returns zeroes if the tenant's schema doesn't have
 * the kiosk tables yet (e.g. a brand-new tenant that hasn't been
 * migrated, though all 6 prod tenants are caught up as of 2026-05-22).
 */
async function getShiftcraftCounts(
  tenantId: string,
): Promise<ShiftcraftCounts> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  try {
    const [locRows, empRows, kioskRows, punchRows] = await forTenant(
      tenantId,
    ).run((tx) =>
      Promise.all([
        tx
          .select({ c: sql<number>`count(*)::int` })
          .from(scLocations)
          .where(eq(scLocations.traceyTenantId, tenantId)),
        tx
          .select({ c: sql<number>`count(*)::int` })
          .from(scEmployees)
          .where(eq(scEmployees.traceyTenantId, tenantId)),
        tx
          .select({ c: sql<number>`count(*)::int` })
          .from(scKioskDevices)
          .where(
            and(
              eq(scKioskDevices.traceyTenantId, tenantId),
              isNull(scKioskDevices.revokedAt),
            ),
          ),
        tx
          .select({ c: sql<number>`count(*)::int` })
          .from(scClockEvents)
          .where(
            and(
              eq(scClockEvents.traceyTenantId, tenantId),
              gte(scClockEvents.occurredAt, sevenDaysAgo),
            ),
          ),
      ]),
    );
    return {
      locations: locRows[0]?.c ?? 0,
      employees: empRows[0]?.c ?? 0,
      activeKiosks: kioskRows[0]?.c ?? 0,
      punchesLast7d: punchRows[0]?.c ?? 0,
    };
  } catch (err) {
    console.error(`[platform/tenants] stats failed for ${tenantId}:`, err);
    return { locations: 0, employees: 0, activeKiosks: 0, punchesLast7d: 0 };
  }
}

export default async function PlatformTenantsPage() {
  // Member counts via one subquery so the main tenant list is a single
  // round trip; ShiftCraft-flavoured stats then fan out per-tenant in
  // parallel (6 prod tenants → 6 parallel reads, trivial).
  const memberCountSubquery = db
    .select({
      tenantId: members.tenantId,
      count: sql<number>`count(*)::int`.as("member_count"),
    })
    .from(members)
    .groupBy(members.tenantId)
    .as("member_counts");

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      plan: tenants.plan,
      status: tenants.status,
      createdAt: tenants.createdAt,
      ownerEmail: users.email,
      memberCount: memberCountSubquery.count,
    })
    .from(tenants)
    .leftJoin(users, eq(users.id, tenants.ownerUserId))
    .leftJoin(
      memberCountSubquery,
      eq(memberCountSubquery.tenantId, tenants.id),
    )
    .orderBy(desc(tenants.createdAt));

  const counts = await Promise.all(rows.map((r) => getShiftcraftCounts(r.id)));
  const countsById = new Map(rows.map((r, i) => [r.id, counts[i]!]));

  return (
    <div className="mx-auto max-w-[1800px] space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tenants</h1>
        <p className="text-sm text-muted-foreground">
          All workspaces using ShiftCraft. Numbers are live from each tenant's
          schema.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            {rows.length} {rows.length === 1 ? "tenant" : "tenants"}
          </h2>
          <span className="text-xs text-muted-foreground">Newest first</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Workspace</th>
                <th className="px-4 py-2 font-medium">Owner</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Members</th>
                <th className="px-4 py-2 text-right font-medium">Locations</th>
                <th className="px-4 py-2 text-right font-medium">Employees</th>
                <th className="px-4 py-2 text-right font-medium">Kiosks</th>
                <th className="px-4 py-2 text-right font-medium">Punches (7d)</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const c = countsById.get(r.id);
                return (
                  <tr key={r.id} className="align-middle">
                    <td className="px-4 py-3">
                      <Link
                        href={`/platform/tenants/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {r.slug}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.ownerEmail ?? "—"}
                    </td>
                    <td className="px-4 py-3 capitalize">{r.plan}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-slate-500 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.memberCount ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c?.locations ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c?.employees ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c?.activeKiosks ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c?.punchesLast7d ?? 0}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.createdAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    No tenants yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
