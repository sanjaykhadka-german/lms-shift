import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { forTenant, scDepartments, scEmployees } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Birthdays & anniversaries · ShiftCraft" };
export const dynamic = "force-dynamic";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function ageOn(today: Date, dob: Date): number {
  let years = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) years -= 1;
  return years;
}

function yearsBetween(today: Date, start: Date): number {
  let years = today.getFullYear() - start.getFullYear();
  const m = today.getMonth() - start.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < start.getDate())) years -= 1;
  return Math.max(0, years);
}

function fmtBirthday(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function parseMonthParam(raw: string | undefined): number {
  if (!raw) return new Date().getMonth() + 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : new Date().getMonth() + 1;
}

export default async function BirthdaysAnniversariesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  const { month: monthRaw } = await searchParams;
  const month = parseMonthParam(monthRaw);
  const monthLabel = MONTHS[month - 1] ?? "—";
  const monthPad = String(month).padStart(2, "0");

  // Birthdays: filter by month component of date_of_birth.
  // Anniversaries: same filter against createdAt (hire date proxy).
  const ctx = forTenant(tenantId);
  const [birthdays, anniversaries] = await Promise.all([
    ctx.run((tx) =>
      tx
        .select({
          id: scEmployees.id,
          fullName: scEmployees.fullName,
          preferredName: scEmployees.preferredName,
          email: scEmployees.email,
          mobile: scEmployees.mobile,
          dateOfBirth: scEmployees.dateOfBirth,
          departmentName: scDepartments.name,
        })
        .from(scEmployees)
        .leftJoin(
          scDepartments,
          eq(scDepartments.id, scEmployees.departmentId),
        )
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            eq(scEmployees.isActive, true),
            sql`${scEmployees.dateOfBirth} is not null`,
            sql`to_char(${scEmployees.dateOfBirth}, 'MM') = ${monthPad}`,
          ),
        )
        .orderBy(
          sql`to_char(${scEmployees.dateOfBirth}, 'DD')`,
          asc(scEmployees.fullName),
        ),
    ),
    ctx.run((tx) =>
      tx
        .select({
          id: scEmployees.id,
          fullName: scEmployees.fullName,
          preferredName: scEmployees.preferredName,
          email: scEmployees.email,
          mobile: scEmployees.mobile,
          createdAt: scEmployees.createdAt,
          departmentName: scDepartments.name,
        })
        .from(scEmployees)
        .leftJoin(
          scDepartments,
          eq(scDepartments.id, scEmployees.departmentId),
        )
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            eq(scEmployees.isActive, true),
            sql`to_char(${scEmployees.createdAt}, 'MM') = ${monthPad}`,
          ),
        )
        .orderBy(
          sql`to_char(${scEmployees.createdAt}, 'DD')`,
          asc(scEmployees.fullName),
        ),
    ),
  ]);

  const today = new Date();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Birthdays & anniversaries
            <InfoPopover label="About employee milestones">
              <p>
                Team-member birthdays and work anniversaries in the next
                ~90 days, scoped to active employees. Use it to plan
                cards / cake / the awkward all-hands shout-out.
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Team-member milestones for {monthLabel}.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/reports">← Back to reports</Link>
        </Button>
      </div>

      {/* Month picker */}
      <form
        method="get"
        className="flex flex-wrap items-center gap-2"
      >
        <label htmlFor="month-picker" className="text-xs uppercase tracking-wider text-muted-foreground">
          Month
        </label>
        <select
          id="month-picker"
          name="month"
          defaultValue={month}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
      </form>

      {/* ─── Birthdays ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            Team member birthdays ({birthdays.length})
          </h2>
        </div>
        {birthdays.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No birthdays in {monthLabel} for active employees with a DOB on
            file.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Preferred name</th>
                  <th className="px-4 py-2 font-medium">Full name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Department</th>
                  <th className="px-4 py-2 font-medium">Birthday</th>
                  <th className="px-4 py-2 font-medium">Date of birth</th>
                  <th className="px-4 py-2 font-medium">Age</th>
                  <th className="px-4 py-2 font-medium">Mobile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {birthdays.map((b) => {
                  const dob = b.dateOfBirth ? new Date(b.dateOfBirth) : null;
                  return (
                    <tr key={b.id}>
                      <td className="px-4 py-2 font-medium">
                        {b.preferredName || b.fullName}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        <Link
                          href={`/app/employees/${b.id}/edit`}
                          className="hover:underline"
                        >
                          {b.fullName}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {b.email ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {b.departmentName ?? "—"}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums">
                        {dob ? fmtBirthday(dob) : "—"}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums text-muted-foreground">
                        {dob ? fmtDate(dob) : "—"}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums">
                        {dob ? ageOn(today, dob) : "—"}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums text-muted-foreground">
                        {b.mobile ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Anniversaries ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            Team member anniversaries ({anniversaries.length})
          </h2>
        </div>
        {anniversaries.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            Nobody joined in {monthLabel}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Preferred name</th>
                  <th className="px-4 py-2 font-medium">Full name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Department</th>
                  <th className="px-4 py-2 font-medium">Hire date</th>
                  <th className="px-4 py-2 font-medium">Years</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {anniversaries.map((a) => {
                  const hire = a.createdAt;
                  const years = yearsBetween(today, hire);
                  return (
                    <tr key={a.id}>
                      <td className="px-4 py-2 font-medium">
                        {a.preferredName || a.fullName}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        <Link
                          href={`/app/employees/${a.id}/edit`}
                          className="hover:underline"
                        >
                          {a.fullName}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {a.email ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {a.departmentName ?? "—"}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums">
                        {fmtDate(hire)}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums">
                        {years === 0 ? "—" : `${years} ${years === 1 ? "year" : "years"}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
