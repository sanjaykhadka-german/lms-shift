import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  lmsAssignments,
  lmsAttempts,
  lmsDepartments,
  lmsEmployers,
  lmsMachines,
  lmsModules,
  lmsPositions,
  lmsUsers,
} from "@tracey/db";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock4,
  MapPin,
  Target,
  TrendingUp,
  Users,
  UserCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { requireAdmin } from "~/lib/auth/admin";
import { formatDate, formatDateTime } from "~/lib/format/datetime";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { buildDashboardModel } from "~/lib/lms/dashboard";
import { AssignmentReminderButton } from "./_components/ReminderButtons";
import { DashboardFilters } from "./_components/DashboardFilters";
import { DashboardCharts } from "./_components/DashboardCharts";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

export const metadata = { title: "Admin" };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Search = {
  reminders?: string;
  from?: string;
  to?: string;
  dept?: string;
  module?: string;
  reset?: string;
};

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const sp = await searchParams;

  // Resolve filters with defaults: last 30 days, no dept/module narrowing.
  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getTime() + MS_PER_DAY);
  const isReset = sp.reset === "1";
  const defaultFrom = new Date(today.getTime() - 30 * MS_PER_DAY);
  const from = isReset ? defaultFrom : parseDate(sp.from) ?? defaultFrom;
  const to = isReset ? tomorrow : parseDate(sp.to) ?? tomorrow;
  const deptId =
    !isReset && sp.dept && sp.dept !== "all" ? Number(sp.dept) : null;
  const moduleId =
    !isReset && sp.module && sp.module !== "all" ? Number(sp.module) : null;

  const [
    [{ employeeCount = 0 } = {}],
    [{ activeCount = 0 } = {}],
    [{ deptCount = 0 } = {}],
    [{ employerCount = 0 } = {}],
    [{ machineCount = 0 } = {}],
    [{ positionCount = 0 } = {}],
    [{ moduleCount = 0 } = {}],
    [{ assignmentCount = 0 } = {}],
    [{ attemptCount = 0 } = {}],
    departments,
    modules,
    model,
  ] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({ employeeCount: sql<number>`count(*)::int` })
        .from(lmsUsers)
        .where(eq(lmsUsers.traceyTenantId, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ activeCount: sql<number>`count(*)::int` })
        .from(lmsUsers)
        .where(and(eq(lmsUsers.isActiveFlag, true), eq(lmsUsers.traceyTenantId, tid))),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ deptCount: sql<number>`count(*)::int` })
        .from(lmsDepartments)
        .where(tenantWhere(lmsDepartments, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ employerCount: sql<number>`count(*)::int` })
        .from(lmsEmployers)
        .where(tenantWhere(lmsEmployers, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ machineCount: sql<number>`count(*)::int` })
        .from(lmsMachines)
        .where(tenantWhere(lmsMachines, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ positionCount: sql<number>`count(*)::int` })
        .from(lmsPositions)
        .where(tenantWhere(lmsPositions, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ moduleCount: sql<number>`count(*)::int` })
        .from(lmsModules)
        .where(tenantWhere(lmsModules, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ assignmentCount: sql<number>`count(*)::int` })
        .from(lmsAssignments)
        .where(tenantWhere(lmsAssignments, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ attemptCount: sql<number>`count(*)::int` })
        .from(lmsAttempts)
        .where(tenantWhere(lmsAttempts, tid)),
    ),
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
        .where(tenantWhere(lmsModules, tid))
        .orderBy(asc(lmsModules.title)),
    ),
    buildDashboardModel({
      tid,
      from,
      to,
      deptId,
      moduleId,
      auditMode: ctx.tenantAuditMode,
      auditSettings: ctx.tenantAuditSettings,
    }),
  ]);

  const fromStr = toIsoDate(from);
  const toStr = toIsoDate(new Date(to.getTime() - MS_PER_DAY)); // inclusive end
  const deptStr = deptId != null ? String(deptId) : "all";
  const moduleStr = moduleId != null ? String(moduleId) : "all";

  const firstName = (ctx.lmsUser.name ?? "").trim().split(/\s+/)[0] || "there";
  const greeting = greetingForHour(new Date(), ctx.tenantTimezone);
  const todayLabel = formatDate(today, ctx.tenantTimezone, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
            {todayLabel}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            Here&apos;s how training is tracking right now.
          </p>
        </div>
        <AssignmentReminderButton />
      </div>

      {sp.reminders !== undefined && (
        <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-2 text-sm dark:bg-emerald-900/10">
          Sent reminders to {sp.reminders} employee
          {sp.reminders === "1" ? "" : "s"}.
        </div>
      )}

      <SectionTitle>Workspace at a glance</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <WorkspaceChip
          icon={Users}
          label="Employees"
          value={employeeCount}
          hint={`${activeCount} active`}
          href="/app/admin/employees"
        />
        <WorkspaceChip
          icon={BookOpen}
          label="Modules"
          value={moduleCount}
          hint={`${assignmentCount} assignments`}
          href="/app/admin/modules"
        />
        <WorkspaceChip icon={BarChart3} label="Attempts" value={attemptCount} hint="all time" />
        <WorkspaceChip icon={Building2} label="Departments" value={deptCount} href="/app/admin/departments" />
        <WorkspaceChip icon={Briefcase} label="Employers" value={employerCount} href="/app/admin/employers" />
        <WorkspaceChip icon={MapPin} label="Positions" value={positionCount} href="/app/admin/positions" />
        <WorkspaceChip icon={Wrench} label="Machines" value={machineCount} href="/app/admin/machines" />
      </div>

      <SectionTitle>Training insights</SectionTitle>
      <DashboardFilters
        from={fromStr}
        to={toStr}
        deptId={deptStr}
        moduleId={moduleStr}
        departments={departments.map((d) => ({ id: d.id, label: d.name }))}
        modules={modules.map((m) => ({ id: m.id, label: m.title }))}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HeroKpi
          icon={Target}
          label="Pass rate"
          value={`${Math.round(model.passRate * 100)}%`}
          hint={`${model.attemptsInWindow} attempts in window`}
          percent={model.passRate}
          tone="primary"
        />
        <HeroKpi
          icon={AlertTriangle}
          label="Overdue"
          value={model.overdue}
          hint="assignments past due"
          tone={model.overdue > 0 ? "destructive" : "neutral"}
        />
        <HeroKpi
          icon={Users}
          label="Active learners"
          value={model.activeLearners}
          hint="in window"
          tone="neutral"
        />
        <HeroKpi
          icon={CheckCircle2}
          label="Completion"
          value={`${Math.round(model.completionPct * 100)}%`}
          hint={`${model.completedAssignments}/${model.totalAssignments}`}
          percent={model.completionPct}
          tone="success"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={BarChart3} label="Attempts" value={model.attemptsInWindow} hint="in window" />
        <KpiCard
          icon={TrendingUp}
          label="Avg score"
          value={Math.round(model.avgScore)}
          hint="in window"
        />
        <KpiCard
          icon={Clock4}
          label="Expiring 30d"
          value={model.expiring30d}
          hint="completed certs nearing expiry"
          variant={model.expiring30d > 0 ? "warning" : undefined}
        />
        <KpiCard
          icon={UserCheck}
          label="Need retrain"
          value={model.usersNeedingRetrain}
          hint="overdue + expiring"
          variant={model.usersNeedingRetrain > 0 ? "warning" : undefined}
        />
      </div>

      <DashboardCharts
        timeseries={model.timeseries}
        assignmentStatus={model.assignmentStatus}
        passRateByModule={model.passRateByModule.map((m) => ({
          title: m.title,
          attempts: m.attempts,
          passRate: m.passRate,
        }))}
        passRateByDept={model.passRateByDept.map((d) => ({
          name: d.name,
          attempts: d.attempts,
          passRate: d.passRate,
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <TableCard
          title="Top 5 learners"
          icon={TrendingUp}
          empty="No learner data in window."
        >
          {model.topLearners.length > 0 && (
            <div className="divide-y divide-[color:var(--border)]">
              <RowHeader cols={["Learner", "Attempts", "Avg", "Pass rate"]} />
              {model.topLearners.map((l) => (
                <div
                  key={l.name}
                  className="grid grid-cols-[1fr_auto_auto_140px] items-center gap-3 px-4 py-2 text-sm"
                >
                  <div className="truncate font-medium">{l.name}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {l.attempts}
                  </div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {Math.round(l.avgScore)}
                  </div>
                  <PassRatePill rate={l.passRate} />
                </div>
              ))}
            </div>
          )}
        </TableCard>

        <TableCard
          title="Modules needing attention"
          icon={AlertTriangle}
          empty="No attempts in window."
        >
          {model.problemModules.length > 0 && (
            <div className="divide-y divide-[color:var(--border)]">
              <RowHeader cols={["Module", "Attempts", "Pass rate"]} />
              {model.problemModules.map((m) => (
                <div
                  key={m.title}
                  className="grid grid-cols-[1fr_auto_140px] items-center gap-3 px-4 py-2 text-sm"
                >
                  <div className="truncate font-medium">{m.title}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {m.attempts}
                  </div>
                  <PassRatePill rate={m.passRate} />
                </div>
              ))}
            </div>
          )}
        </TableCard>

        <TableCard
          title="Users needing retrain"
          icon={UserCheck}
          empty="No outstanding overdue or expiring training."
        >
          {model.usersNeedingRetrainList.length > 0 && (
            <div className="divide-y divide-[color:var(--border)]">
              <RowHeader cols={["User", "Overdue", "Expiring 30d"]} />
              {model.usersNeedingRetrainList.map((u) => (
                <div
                  key={u.name}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-sm"
                >
                  <div className="truncate font-medium">{u.name}</div>
                  <div>
                    {u.overdueCount > 0 ? (
                      <Badge variant="destructive">{u.overdueCount}</Badge>
                    ) : (
                      <span className="text-xs text-[color:var(--muted-foreground)]">0</span>
                    )}
                  </div>
                  <div>
                    {u.expiringCount > 0 ? (
                      <Badge variant="warning">{u.expiringCount}</Badge>
                    ) : (
                      <span className="text-xs text-[color:var(--muted-foreground)]">0</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TableCard>

        <TableCard
          title="Recent attempts"
          icon={ClipboardCheck}
          empty="No attempts recorded yet."
        >
          {model.recentAttempts.length > 0 && (
            <div className="divide-y divide-[color:var(--border)]">
              {model.recentAttempts.map((r) => {
                const Icon = r.passed ? CheckCircle2 : XCircle;
                const iconCls = r.passed
                  ? "text-emerald-500"
                  : "text-[color:var(--destructive)]";
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 px-4 py-2 text-sm"
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${iconCls}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        <strong>{r.userName}</strong>{" "}
                        <span className="text-[color:var(--muted-foreground)]">→</span>{" "}
                        {r.moduleTitle}
                      </div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">
                        {formatDateTime(r.createdAt, ctx.tenantTimezone)}
                      </div>
                    </div>
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      {r.score}
                    </span>
                    <Badge variant={r.passed ? "success" : "destructive"}>
                      {r.passed ? "Pass" : "Fail"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </TableCard>
      </div>
    </div>
  );
}

type LucideIcon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-[color:var(--border)] pb-2 text-base font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function WorkspaceChip({
  icon: Icon,
  label,
  value,
  hint,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-1.5 text-xs",
        href && "transition-colors hover:bg-[color:var(--secondary)]",
      )}
    >
      <Icon className="h-3.5 w-3.5 text-[color:var(--muted-foreground)]" aria-hidden />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-[color:var(--muted-foreground)]">{label}</span>
      {hint && (
        <span className="text-[color:var(--muted-foreground)]/70">· {hint}</span>
      )}
    </span>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

type HeroTone = "primary" | "success" | "destructive" | "warning" | "neutral";

function HeroKpi({
  icon: Icon,
  label,
  value,
  hint,
  percent,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  hint?: string;
  /** 0..1 — when set, renders a thin progress bar at the bottom. */
  percent?: number;
  tone: HeroTone;
}) {
  const toneCls = {
    primary: "border-blue-200 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/30",
    success: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/30",
    destructive: "border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/30",
    warning: "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30",
    neutral: "border-[color:var(--border)] bg-[color:var(--card)]",
  }[tone];
  const iconCls = {
    primary: "text-blue-600 dark:text-blue-400",
    success: "text-emerald-600 dark:text-emerald-400",
    destructive: "text-red-600 dark:text-red-400",
    warning: "text-amber-600 dark:text-amber-400",
    neutral: "text-[color:var(--muted-foreground)]",
  }[tone];
  const barCls = {
    primary: "bg-blue-500",
    success: "bg-emerald-500",
    destructive: "bg-red-500",
    warning: "bg-amber-500",
    neutral: "bg-[color:var(--muted-foreground)]",
  }[tone];
  const pct =
    typeof percent === "number" && Number.isFinite(percent)
      ? Math.max(0, Math.min(1, percent))
      : null;
  return (
    <div className={cn("rounded-2xl border p-5", toneCls)}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wider text-[color:var(--muted-foreground)]">
          {label}
        </div>
        <Icon className={cn("h-5 w-5", iconCls)} aria-hidden />
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
          {hint}
        </div>
      )}
      {pct !== null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--border)]/60">
          <div
            className={cn("h-full rounded-full transition-[width]", barCls)}
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  variant,
}: {
  icon?: LucideIcon;
  label: string;
  value: number | string;
  hint?: string;
  variant?: "destructive" | "warning";
}) {
  const accent =
    variant === "destructive"
      ? "border-red-300 dark:border-red-800"
      : variant === "warning"
        ? "border-amber-300 dark:border-amber-800"
        : "border-[color:var(--border)]";
  return (
    <div className={cn("rounded-xl border bg-[color:var(--card)] p-4", accent)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
          {label}
        </div>
        {Icon && (
          <Icon className="h-4 w-4 text-[color:var(--muted-foreground)]" aria-hidden />
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && (
        <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
          {hint}
        </div>
      )}
    </div>
  );
}

function TableCard({
  title,
  icon: Icon,
  empty,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  empty: string;
  children: React.ReactNode;
}) {
  const hasContent = children !== false && children !== null && children !== undefined;
  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--card)]">
      <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-4 py-3 text-sm font-semibold">
        {Icon && (
          <Icon className="h-4 w-4 text-[color:var(--muted-foreground)]" aria-hidden />
        )}
        {title}
      </div>
      {hasContent ? (
        children
      ) : (
        <div className="px-4 py-6 text-center text-sm text-[color:var(--muted-foreground)]">
          {empty}
        </div>
      )}
    </div>
  );
}

function RowHeader({ cols }: { cols: string[] }) {
  return (
    <div
      className="grid items-center gap-3 px-4 py-2 text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]"
      style={{
        gridTemplateColumns:
          cols.length === 4
            ? "1fr auto auto 140px"
            : cols.length === 3
              ? "1fr auto 140px"
              : `repeat(${cols.length}, auto)`,
      }}
    >
      {cols.map((c) => (
        <div key={c}>{c}</div>
      ))}
    </div>
  );
}

function PassRatePill({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const cls =
    rate >= 0.85
      ? "bg-emerald-500"
      : rate >= 0.6
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[color:var(--border)]/60">
        <div
          className={cn("h-full rounded-full", cls)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-[color:var(--muted-foreground)]">
        {pct}%
      </span>
    </div>
  );
}

function greetingForHour(now: Date, timezone: string): string {
  // Derive the local hour in the tenant's timezone via Intl.
  const hour = parseInt(
    new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).format(now),
    10,
  );
  if (Number.isNaN(hour)) return "Hello";
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return startOfDay(new Date(t));
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
