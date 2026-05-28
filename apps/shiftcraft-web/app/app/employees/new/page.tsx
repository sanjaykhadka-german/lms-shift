import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { forTenant, scDepartments } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { EmployeeForm } from "./_form";

export const metadata = { title: "Add employee · ShiftCraft" };

export default async function NewEmployeePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; fullName?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const { email, fullName } = await searchParams;

  const departments = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({ name: scDepartments.name })
      .from(scDepartments)
      .where(eq(scDepartments.traceyTenantId, membership.tenant.id))
      .orderBy(asc(scDepartments.name)),
  );

  // When linked from the "Add to roster" affordance on /app/employees, the
  // query string pre-fills name + email so the manager doesn't retype and
  // — more importantly — the email matches the existing app.users row so
  // the dedupe logic on the list page later merges the two records into
  // one. Other fields stay default.
  const prefilled =
    email || fullName
      ? {
          fullName: fullName ?? "",
          email: email ?? null,
          mobile: null,
          department: null,
          employmentType: "full_time",
          hourlyRate: null,
          notes: null,
          availability: null,
          preferredName: null,
          gender: null,
          dateOfBirth: null,
          addressLine: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
        }
      : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Add employee</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add someone to your ShiftCraft roster. Full-time, part-time and
            casual staff with an email will trigger a "suggest as learner"
            notification in the LMS so training can be assigned. Contractor
            rows stay ShiftCraft-only.
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
          defaultValues={prefilled}
          departmentSuggestions={departments.map((d) => d.name)}
        />
      </section>
    </div>
  );
}
