import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scDepartments,
  scEmployeePins,
  scEmployees,
  type Role,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { EmployeeForm } from "../../new/_form";
import { deleteEmployeeAction } from "../../new/actions";
import { SetPinCard } from "./_set_pin_card";
import { RoleCard } from "./_role_card";

export const metadata = { title: "Edit employee · ShiftCraft" };

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        appUserId: scEmployees.appUserId,
        fullName: scEmployees.fullName,
        email: scEmployees.email,
        mobile: scEmployees.mobile,
        departmentName: scDepartments.name,
        employmentType: scEmployees.employmentType,
        hourlyRate: scEmployees.hourlyRate,
        notes: scEmployees.notes,
        availability: scEmployees.availability,
        createdAt: scEmployees.createdAt,
        preferredName: scEmployees.preferredName,
        gender: scEmployees.gender,
        dateOfBirth: scEmployees.dateOfBirth,
        addressLine: scEmployees.addressLine,
        emergencyContactName: scEmployees.emergencyContactName,
        emergencyContactPhone: scEmployees.emergencyContactPhone,
      })
      .from(scEmployees)
      .leftJoin(
        scDepartments,
        eq(scDepartments.id, scEmployees.departmentId),
      )
      .where(
        and(
          eq(scEmployees.id, id),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!row) notFound();

  // PIN state is only queried when the employee has an attached auth user.
  // Labour-hire roster rows never have a PIN — the card just doesn't render.
  const pinRow =
    row.appUserId !== null
      ? (
          await forTenant(tenantId).run((tx) =>
            tx
              .select({ lastUsedAt: scEmployeePins.lastUsedAt })
              .from(scEmployeePins)
              .where(
                and(
                  eq(scEmployeePins.appUserId, row.appUserId!),
                  eq(scEmployeePins.traceyTenantId, tenantId),
                ),
              )
              .limit(1),
          )
        )[0] ?? null
      : null;

  // Membership role for the linked auth user, if any. Lives in app.members
  // (shared schema across all Tracey apps) so plain `db`, not forTenant.
  const memberRow =
    row.appUserId !== null
      ? (
          await db
            .select({ role: members.role })
            .from(members)
            .where(
              and(
                eq(members.userId, row.appUserId),
                eq(members.tenantId, tenantId),
              ),
            )
            .limit(1)
        )[0] ?? null
      : null;

  // Needed for the self-demotion confirm on the role card.
  const viewer = await currentUser();

  const departments = await forTenant(tenantId).run((tx) =>
    tx
      .select({ name: scDepartments.name })
      .from(scDepartments)
      .where(eq(scDepartments.traceyTenantId, tenantId))
      .orderBy(asc(scDepartments.name)),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Edit employee
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Added{" "}
            {row.createdAt.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {row.email ? ` · ${row.email}` : ""}
          </p>
        </div>
        <Link
          href="/app/employees"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to roster
        </Link>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <EmployeeForm
          mode="edit"
          employeeId={row.id}
          defaultValues={{
            fullName: row.fullName,
            email: row.email,
            mobile: row.mobile,
            department: row.departmentName,
            employmentType: row.employmentType,
            hourlyRate: row.hourlyRate,
            notes: row.notes,
            availability: row.availability as Record<string, string> | null,
            preferredName: row.preferredName,
            gender: row.gender,
            dateOfBirth: row.dateOfBirth,
            addressLine: row.addressLine,
            emergencyContactName: row.emergencyContactName,
            emergencyContactPhone: row.emergencyContactPhone,
          }}
          departmentSuggestions={departments.map((d) => d.name)}
        />
      </section>

      {row.appUserId && isAtLeastManager(membership.role) ? (
        <SetPinCard
          appUserId={row.appUserId}
          hasPin={pinRow !== null}
          lastUsedAt={pinRow?.lastUsedAt ?? null}
        />
      ) : null}

      {row.appUserId && memberRow && isAtLeastManager(membership.role) ? (
        <RoleCard
          appUserId={row.appUserId}
          currentRole={memberRow.role as Role}
          viewerRole={membership.role as Role}
          isSelf={viewer?.id === row.appUserId}
        />
      ) : null}

      <section className="rounded-lg border border-[color:var(--destructive)]/30 bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[color:var(--destructive)]">
          Delete employee
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Removes the row from the ShiftCraft roster. The person's auth
          account (if any) is unaffected.
        </p>
        <form action={deleteEmployeeAction} className="mt-3">
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
