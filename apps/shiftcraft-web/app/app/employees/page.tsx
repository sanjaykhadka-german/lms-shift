import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scDepartments,
  scEmployees,
  users,
  type ScEmploymentType,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { friendlyRoleLabel } from "~/lib/roles";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";

export const metadata = { title: "Employees · ShiftCraft" };

// Tailwind v4's themed palette renders bg-X-100/text-X-800 pairs as
// low-contrast tints under this app's @theme inline tokens. Using solid
// fills with white text guarantees legibility regardless of theme.
const ROLE_BADGE: Record<string, string> = {
  owner: "bg-indigo-600 text-white",
  admin: "bg-blue-600 text-white",
  member: "bg-slate-500 text-white",
};

const EMPLOYMENT_BADGE: Record<ScEmploymentType, string> = {
  permanent: "bg-emerald-600 text-white",
  casual: "bg-amber-500 text-white",
  labour_hire: "bg-purple-600 text-white",
};

const EMPLOYMENT_LABEL: Record<ScEmploymentType, string> = {
  permanent: "Permanent",
  casual: "Casual",
  labour_hire: "Labour hire",
};

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const { added } = await searchParams;

  // Auth-side roster (people with a Tracey login + tenant membership).
  const memberRoster = await db
    .select({
      memberId: members.id,
      role: members.role,
      joinedAt: members.createdAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.tenantId, membership.tenant.id))
    .orderBy(asc(users.name), asc(users.email));

  // ShiftCraft-side HR roster (sc_employees rows, incl. labour-hire / no auth).
  const scRoster = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        fullName: scEmployees.fullName,
        email: scEmployees.email,
        mobile: scEmployees.mobile,
        department: scDepartments.name,
        employmentType: scEmployees.employmentType,
        appUserId: scEmployees.appUserId,
        isActive: scEmployees.isActive,
      })
      .from(scEmployees)
      .leftJoin(
        scDepartments,
        eq(scDepartments.id, scEmployees.departmentId),
      )
      .where(eq(scEmployees.traceyTenantId, membership.tenant.id))
      .orderBy(asc(scEmployees.fullName)),
  );

  // Dedupe overlap: a ShiftCraft row that's already linked to an app.users via
  // appUserId (or matched by email) is shown only once — as the auth-side row
  // with its employment_type/department/mobile pulled across. This keeps the
  // list from doubling up once we wire the "confirm learner" flow later.
  const memberEmailToShiftcraft = new Map<string, (typeof scRoster)[number]>();
  const memberUserIdToShiftcraft = new Map<string, (typeof scRoster)[number]>();
  for (const r of scRoster) {
    if (r.appUserId) memberUserIdToShiftcraft.set(r.appUserId, r);
    if (r.email) memberEmailToShiftcraft.set(r.email.toLowerCase(), r);
  }
  const linkedShiftcraftIds = new Set<string>();
  const memberRows = memberRoster.map((m) => {
    const linked =
      memberUserIdToShiftcraft.get(m.userId) ??
      memberEmailToShiftcraft.get(m.email.toLowerCase());
    if (linked) linkedShiftcraftIds.add(linked.id);
    return { ...m, shiftcraft: linked ?? null };
  });
  const shiftcraftOnly = scRoster.filter((r) => !linkedShiftcraftIds.has(r.id));

  const total = memberRows.length + shiftcraftOnly.length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} {total === 1 ? "person" : "people"} on the roster for{" "}
            {membership.tenant.name}.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/employees/new">Add employee</Link>
        </Button>
      </div>

      {added === "1" && (
        <div className="rounded-md border-2 border-emerald-500/60 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-950/50 dark:text-emerald-100">
          Employee added.
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {total === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No one on the roster yet — use Add employee above to get started.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {memberRows.map((r) => (
              <li
                key={`m-${r.memberId}`}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={r.name}
                    email={r.email}
                    image={r.image}
                    sizeClass="h-9 w-9"
                    textClass="text-xs"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {r.name ?? r.email}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.name ? r.email : null}
                      {r.shiftcraft?.department ? ` · ${r.shiftcraft.department}` : ""}
                      {r.shiftcraft?.mobile ? ` · ${r.shiftcraft.mobile}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {r.shiftcraft && (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${EMPLOYMENT_BADGE[r.shiftcraft.employmentType as ScEmploymentType]}`}
                    >
                      {EMPLOYMENT_LABEL[r.shiftcraft.employmentType as ScEmploymentType]}
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ROLE_BADGE[r.role] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {friendlyRoleLabel(r.role)}
                  </span>
                  {r.shiftcraft ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/app/employees/${r.shiftcraft.id}/edit`}>
                        Edit
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/app/employees/new?email=${encodeURIComponent(r.email)}&fullName=${encodeURIComponent(r.name ?? "")}`}
                      >
                        Add to roster
                      </Link>
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {shiftcraftOnly.map((r) => (
              <li
                key={`sc-${r.id}`}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={r.fullName}
                    email={r.email ?? r.fullName}
                    image={null}
                    sizeClass="h-9 w-9"
                    textClass="text-xs"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.fullName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.email ?? "No email"}
                      {r.department ? ` · ${r.department}` : ""}
                      {r.mobile ? ` · ${r.mobile}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${EMPLOYMENT_BADGE[r.employmentType as ScEmploymentType]}`}
                  >
                    {EMPLOYMENT_LABEL[r.employmentType as ScEmploymentType]}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    ShiftCraft only
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/app/employees/${r.id}/edit`}>Edit</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
