import Link from "next/link";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  db,
  lmsAssignments,
  lmsDepartments,
  lmsModules,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import {
  latestAttemptsByUserModule,
  type LatestAttemptCell,
} from "~/lib/lms/dashboard";
import { formatDate } from "~/lib/format/datetime";
import { Button } from "~/components/ui/button";
import { HelpPopover } from "~/components/ui/help-popover";

export const metadata = { title: "Training matrix" };

type Search = { dept?: string; module?: string; q?: string };

export default async function TrainingMatrixPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const tz = ctx.tenantTimezone;
  const sp = await searchParams;

  const deptFilter = sp.dept && sp.dept !== "all" ? Number(sp.dept) : null;
  const moduleFilter =
    sp.module && sp.module !== "all" ? Number(sp.module) : null;
  const q = (sp.q ?? "").trim();

  // Dropdown sources + axis sources.
  const [departments, allModules] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsDepartments.id, name: lmsDepartments.name })
        .from(lmsDepartments)
        .where(tenantWhere(lmsDepartments, tid))
        .orderBy(asc(lmsDepartments.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsModules.id, title: lmsModules.title })
        .from(lmsModules)
        .where(
          and(tenantWhere(lmsModules, tid), eq(lmsModules.isPublished, true)),
        )
        .orderBy(asc(lmsModules.title)),
    ),
  ]);
  const modules =
    moduleFilter != null
      ? allModules.filter((m) => m.id === moduleFilter)
      : allModules;

  // Users (Y-axis) — active only, optional dept + name/email search.
  const userFilters = [
    eq(lmsUsers.traceyTenantId, tid),
    eq(lmsUsers.isActiveFlag, true),
  ];
  if (deptFilter != null) {
    userFilters.push(eq(lmsUsers.departmentId, deptFilter));
  }
  if (q) {
    const pat = `%${q}%`;
    const orExpr = or(ilike(lmsUsers.name, pat), ilike(lmsUsers.email, pat));
    if (orExpr) userFilters.push(orExpr);
  }
  const users = await ctx.db.run((tx) =>
    tx
      .select({
        id: lmsUsers.id,
        name: lmsUsers.name,
        email: lmsUsers.email,
        departmentId: lmsUsers.departmentId,
        departmentName: lmsDepartments.name,
      })
      .from(lmsUsers)
      .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
      .where(and(...userFilters))
      .orderBy(
        sql`coalesce(${lmsDepartments.name}, '') asc`,
        asc(lmsUsers.name),
      ),
  );

  // Assignments (for "•" state).
  const userIds = users.map((u) => u.id);
  const moduleIds = modules.map((m) => m.id);
  const assignmentSet = new Set<string>();
  if (userIds.length > 0 && moduleIds.length > 0) {
    const assignFilters = [
      eq(lmsAssignments.traceyTenantId, tid),
      inArray(lmsAssignments.userId, userIds),
      inArray(lmsAssignments.moduleId, moduleIds),
    ];
    const rows = await ctx.db.run((tx) =>
      tx
        .select({
          userId: lmsAssignments.userId,
          moduleId: lmsAssignments.moduleId,
        })
        .from(lmsAssignments)
        .where(and(...assignFilters)),
    );
    for (const r of rows) assignmentSet.add(`${r.userId}|${r.moduleId}`);
  }

  // Latest attempts by (user, module). In Audit Mode the inner query
  // filters to passing attempts only so failed cells collapse to blank.
  const latest = await latestAttemptsByUserModule(tid, {
    auditMode: ctx.tenantAuditMode && ctx.tenantAuditSettings.hideFailedAttempts,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
            Training matrix
            <HelpPopover label="About the training matrix">
              A grid of every active employee × every published module. Each
              cell shows the latest result: <strong>✓</strong> = passed (with
              date), <strong>✗</strong> = failed, <strong>•</strong> =
              assigned but not yet attempted, blank = not assigned. Use the
              filters above to narrow by department, single module, or name.
            </HelpPopover>
          </h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Pass / fail status for every active employee across every published
            module. To control which modules a department auto-assigns, see{" "}
            <Link
              href="/app/admin/departments/policies"
              className="underline hover:text-[color:var(--foreground)]"
            >
              Department policies
            </Link>
            .
          </p>
        </div>
        <Legend />
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--card)] p-3"
      >
        <FilterField label="Department">
          <select
            name="dept"
            defaultValue={sp.dept ?? "all"}
            className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm"
          >
            <option value="all">All</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Module">
          <select
            name="module"
            defaultValue={sp.module ?? "all"}
            className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm"
          >
            <option value="all">All</option>
            {allModules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Employee">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Name or email…"
            className="h-9 w-56 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm"
          />
        </FilterField>
        <div className="ml-auto flex gap-2">
          <Button type="submit" variant="default">
            Apply
          </Button>
          <Link
            href="/app/admin/training-matrix"
            className="inline-flex h-9 items-center rounded-md border border-[color:var(--border)] px-3 text-sm hover:bg-[color:var(--accent)]"
          >
            Reset
          </Link>
        </div>
      </form>

      {users.length === 0 || modules.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--border)] p-6 text-center text-sm text-[color:var(--muted-foreground)]">
          {users.length === 0
            ? "No employees match the current filters."
            : "No published modules match the current filters."}
        </div>
      ) : (
        <div className="overflow-auto rounded-md border border-[color:var(--border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[color:var(--secondary)]">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-20 bg-[color:var(--secondary)] px-3 py-2 text-left font-medium"
                >
                  Employee
                </th>
                {modules.map((m) => (
                  <th
                    key={m.id}
                    scope="col"
                    className="h-48 px-1 py-2 align-bottom font-medium"
                    title={m.title}
                  >
                    <div className="mx-auto whitespace-nowrap [writing-mode:vertical-rl] [transform:rotate(180deg)]">
                      {m.title}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const userLatest = latest.get(u.id);
                return (
                  <tr key={u.id} className="border-t border-[color:var(--border)]">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-[color:var(--background)] px-3 py-2 text-left font-medium whitespace-nowrap"
                    >
                      <div>{u.name}</div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">
                        {u.departmentName ?? "—"}
                      </div>
                    </th>
                    {modules.map((m) => {
                      const entry = userLatest?.get(m.id);
                      const isAssigned = assignmentSet.has(`${u.id}|${m.id}`);
                      return (
                        <td
                          key={m.id}
                          className="px-3 py-2 text-center align-middle"
                          aria-label={cellLabel(entry, isAssigned, u.name, m.title, tz)}
                        >
                          {renderCell(entry, isAssigned, tz)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[color:var(--muted-foreground)]">
        {users.length} employee{users.length === 1 ? "" : "s"} ×{" "}
        {modules.length} module{modules.length === 1 ? "" : "s"}.
      </p>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </span>
      {children}
    </label>
  );
}

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

function renderCell(
  entry: LatestAttemptCell | undefined,
  isAssigned: boolean,
  timezone: string | null,
) {
  if (entry?.passed === true) {
    const dateText = entry.passedAt ? formatDate(entry.passedAt, timezone, DATE_OPTS) : "";
    return (
      <div className="flex flex-col items-center leading-tight">
        <span className="text-emerald-600 dark:text-emerald-400" aria-hidden>
          ✓
        </span>
        {dateText ? (
          <span className="mt-0.5 text-xs whitespace-nowrap text-[color:var(--muted-foreground)]">
            {dateText}
          </span>
        ) : null}
      </div>
    );
  }
  if (entry?.passed === false) {
    return (
      <span className="text-red-600 dark:text-red-400" aria-hidden>
        ✗
      </span>
    );
  }
  if (isAssigned) {
    return (
      <span className="text-[color:var(--muted-foreground)]" aria-hidden>
        •
      </span>
    );
  }
  return (
    <span className="text-[color:var(--muted-foreground)]" aria-hidden>
      —
    </span>
  );
}

function cellLabel(
  entry: LatestAttemptCell | undefined,
  isAssigned: boolean,
  user: string,
  mod: string,
  timezone: string | null,
): string {
  if (entry?.passed === true) {
    const when = entry.passedAt ? formatDate(entry.passedAt, timezone, DATE_OPTS) : "";
    return when ? `${user} passed ${mod} on ${when}` : `${user} passed ${mod}`;
  }
  if (entry?.passed === false) return `${user} failed ${mod}`;
  if (isAssigned) return `${user} assigned ${mod}, no attempt yet`;
  return `${user} not assigned ${mod}`;
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-[color:var(--muted-foreground)]">
      <LegendItem className="text-emerald-600 dark:text-emerald-400" mark="✓">
        Passed
      </LegendItem>
      <LegendItem className="text-red-600 dark:text-red-400" mark="✗">
        Failed
      </LegendItem>
      <LegendItem mark="•">Assigned, no attempt</LegendItem>
      <LegendItem mark="—">Not assigned</LegendItem>
    </div>
  );
}

function LegendItem({
  mark,
  children,
  className,
}: {
  mark: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={className ?? ""} aria-hidden>
        {mark}
      </span>
      <span>{children}</span>
    </span>
  );
}
