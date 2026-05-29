import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { forTenant, scDepartments, scEmployees } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Departments · ShiftCraft" };

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");

  const { added } = await searchParams;
  const tenantId = membership.tenant.id;

  // Correlated subquery counts how many sc_employees rows point at each
  // department. Done in-DB so the query stays O(departments).
  const employeeCount = sql<number>`(
    SELECT count(*)::int FROM ${scEmployees}
    WHERE ${scEmployees.departmentId} = ${scDepartments.id}
  )`;

  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scDepartments.id,
        name: scDepartments.name,
        description: scDepartments.description,
        createdAt: scDepartments.createdAt,
        employees: employeeCount,
      })
      .from(scDepartments)
      .where(eq(scDepartments.traceyTenantId, tenantId))
      .orderBy(asc(scDepartments.name)),
  );

  // "Unassigned" count — employees with no department_id at all.
  const [unassigned] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        c: sql<number>`count(*)::int`,
      })
      .from(scEmployees)
      .where(
        sql`${scEmployees.traceyTenantId} = ${tenantId} AND ${scEmployees.departmentId} IS NULL`,
      ),
  );
  const unassignedCount = unassigned?.c ?? 0;

  const totalEmployees =
    rows.reduce((s, r) => s + r.employees, 0) + unassignedCount;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Departments
            <InfoPopover label="About departments">
              <p>
                Tenant-scoped grouping for employees. Drives the{" "}
                <strong>Hours by department</strong> rollup on{" "}
                <a href="/app/reports" className="underline">
                  Reports
                </a>{" "}
                and the department filter on bulk-offer.
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} department{rows.length === 1 ? "" : "s"} ·{" "}
            {totalEmployees} employee{totalEmployees === 1 ? "" : "s"} on the
            ShiftCraft roster.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/departments/new">New department</Link>
        </Button>
      </div>

      {added === "1" && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          Department created.
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No departments yet. Departments are created automatically when
            you add an employee with a department name — or use{" "}
            <Link
              href="/app/departments/new"
              className="text-primary hover:underline"
            >
              New department
            </Link>{" "}
            to set one up upfront.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    <span className="inline-flex items-center rounded-full bg-[var(--ink-3)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                      {r.employees} {r.employees === 1 ? "employee" : "employees"}
                    </span>
                  </div>
                  {r.description && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {r.description}
                    </div>
                  )}
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/departments/${r.id}/edit`}>Edit</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {unassignedCount > 0 && (
        <p className="rounded-md border border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <strong className="font-medium text-foreground">
            {unassignedCount} employee{unassignedCount === 1 ? "" : "s"}
          </strong>{" "}
          {unassignedCount === 1 ? "is" : "are"} not assigned to any
          department. Edit them from the{" "}
          <Link href="/app/employees" className="text-primary hover:underline">
            roster
          </Link>{" "}
          to pick one.
        </p>
      )}
    </div>
  );
}
