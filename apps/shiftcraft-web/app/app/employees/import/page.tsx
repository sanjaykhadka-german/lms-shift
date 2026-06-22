import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { ImportForm } from "./_form";

export const metadata = { title: "Import employees · ShiftCraft" };

export default async function EmployeeImportPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Import employees
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bulk-add staff to {membership.tenant.name} from a CSV. Duplicate
            emails on the roster are skipped, not overwritten.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/people/team">← Back to Team members</Link>
        </Button>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          CSV format
        </h2>
        <p className="mt-2 text-sm">
          Header row required. Columns (case-insensitive, order doesn't
          matter):
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <code className="rounded bg-muted px-1 font-mono text-xs">firstName</code>{" "}
            +{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">lastName</code>{" "}
            — or a single{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">fullName</code>{" "}
            (a full name is split into first/last automatically).{" "}
            <span className="text-[color:var(--destructive)]">
              name required
            </span>
          </li>
          <li>
            <code className="rounded bg-muted px-1 font-mono text-xs">email</code>{" "}
            — optional; auto-links to an existing tenant member when matched
          </li>
          <li>
            <code className="rounded bg-muted px-1 font-mono text-xs">mobile</code>{" "}
            — optional
          </li>
          <li>
            <code className="rounded bg-muted px-1 font-mono text-xs">department</code>{" "}
            — optional; new departments are created automatically
          </li>
          <li>
            <code className="rounded bg-muted px-1 font-mono text-xs">employmentType</code>{" "}
            — one of <code className="font-mono">full_time</code>,{" "}
            <code className="font-mono">part_time</code>,{" "}
            <code className="font-mono">casual</code>,{" "}
            <code className="font-mono">contractor</code> (defaults to{" "}
            <code className="font-mono">full_time</code>)
          </li>
          <li>
            <code className="rounded bg-muted px-1 font-mono text-xs">hourlyRate</code>{" "}
            — optional; decimal like <code className="font-mono">28.50</code>
          </li>
        </ul>
        <div className="mt-4 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
          <div>firstName,lastName,email,mobile,department,employmentType,hourlyRate</div>
          <div>
            Jane,Doe,jane@example.com,0400 000 000,Butchery,full_time,28.50
          </div>
          <div>John,Roe,,0400 111 222,Counter,casual,25.00</div>
        </div>
      </section>

      <ImportForm />
    </div>
  );
}
