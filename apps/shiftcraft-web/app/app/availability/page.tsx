import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { forTenant, scDepartments, scEmployees } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { AvailabilityForm } from "./_form";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "My availability · ShiftCraft" };

export default async function AvailabilityPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        fullName: scEmployees.fullName,
        department: scDepartments.name,
        employmentType: scEmployees.employmentType,
        availability: scEmployees.availability,
      })
      .from(scEmployees)
      .leftJoin(
        scDepartments,
        eq(scDepartments.id, scEmployees.departmentId),
      )
      .where(
        and(
          eq(scEmployees.appUserId, user.id),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );

  const availability =
    (row?.availability as Record<string, string> | null) ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
          My availability
          <InfoPopover label="About availability">
            <p>
              Tell managers when you can work each weekday. The
              auto-scheduler refuses to assign you outside declared
              windows, and the regular assign form flags a warning
              before offering a shift you&rsquo;d miss.
            </p>
            <p className="mt-1">
              Use a time window like <code>09-17</code> for available, or{" "}
              <code>off</code> to block a day entirely. Updates don&rsquo;t
              affect shifts you&rsquo;ve already accepted.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Managers see this when they're building shifts. Update it whenever
          your hours change — it doesn't affect any shifts you've already
          accepted.
        </p>
      </div>

      {row ? (
        <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 text-xs text-muted-foreground">
            Editing as{" "}
            <span className="font-medium text-foreground">{row.fullName}</span>
            {row.department ? ` · ${row.department}` : ""} ·{" "}
            {row.employmentType.replace(/_/g, "-")}
          </div>
          <AvailabilityForm initialAvailability={availability} />
        </section>
      ) : (
        <section className="flex items-start gap-3 rounded-lg border-2 border-amber-600 bg-amber-500 px-5 py-4 text-sm text-white">
          <span
            aria-hidden
            className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-700 text-sm font-bold"
          >
            !
          </span>
          <div>
            <p className="font-semibold">You're not on the roster yet.</p>
            <p className="mt-1 text-xs text-white/90">
              Ask a manager to add you in{" "}
              <Link
                href="/app/employees"
                className="font-medium underline underline-offset-2 hover:text-white"
              >
                Employees
              </Link>
              . Once they do, you'll be able to set your weekly availability
              here.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
