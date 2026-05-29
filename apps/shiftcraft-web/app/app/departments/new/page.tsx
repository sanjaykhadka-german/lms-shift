import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { DepartmentForm } from "../_form";

export const metadata = { title: "New department · ShiftCraft" };

export default async function NewDepartmentPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app/departments");

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            New department
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set up a team or workgroup. Employees added later can be assigned
            to it from the roster, and Reports lets managers filter hours by
            department.
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
        <DepartmentForm mode="create" />
      </section>
    </div>
  );
}
