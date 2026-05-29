import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { forTenant, scDepartments, scEmployees } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { DepartmentForm } from "../../_form";
import { deleteDepartmentAction } from "../../actions";

export const metadata = { title: "Edit department · ShiftCraft" };

export default async function EditDepartmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app/departments");
  const tenantId = membership.tenant.id;

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scDepartments.id,
        name: scDepartments.name,
        description: scDepartments.description,
        createdAt: scDepartments.createdAt,
        employees: sql<number>`(
          SELECT count(*)::int FROM ${scEmployees}
          WHERE ${scEmployees.departmentId} = ${scDepartments.id}
        )`,
      })
      .from(scDepartments)
      .where(
        and(
          eq(scDepartments.id, id),
          eq(scDepartments.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!row) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Edit {row.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Created{" "}
            {row.createdAt.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {" · "}
            {row.employees} {row.employees === 1 ? "employee" : "employees"}
          </p>
        </div>
        <Link
          href="/app/departments"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back
        </Link>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <DepartmentForm
          mode="edit"
          departmentId={row.id}
          defaultValues={{
            name: row.name,
            description: row.description,
          }}
        />
      </section>

      <section className="rounded-lg border border-[color:var(--destructive)]/30 bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[color:var(--destructive)]">
          Delete department
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {row.employees > 0 ? (
            <>
              {row.employees}{" "}
              {row.employees === 1 ? "employee is" : "employees are"} currently
              assigned to this department. Deleting will leave{" "}
              {row.employees === 1 ? "them" : "them"} with no department — you
              can reassign them from the roster afterwards.
            </>
          ) : (
            "No employees are assigned to this department, so deleting is safe."
          )}
        </p>
        <form action={deleteDepartmentAction} className="mt-3">
          <input type="hidden" name="id" value={row.id} />
          <Button
            type="submit"
            variant="outline"
            className="text-[color:var(--destructive)] border-[color:var(--destructive)]/40 hover:bg-[color:var(--destructive)]/10"
          >
            Delete
          </Button>
        </form>
      </section>
    </div>
  );
}
