import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  forTenant,
  scDepartments,
  scEmployees,
  scXeroEmployeeLinks,
  type ScEmploymentType,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import {
  computeLeaveBalanceForEmployee,
  fmtHours,
  type LeaveBalance,
} from "~/lib/leave-balances";
import {
  fetchAnnualLeaveBalances,
  isXeroConfigured,
  loadConnection,
  type XeroAnnualLeave,
} from "~/lib/payroll/xero";
import { Badge, type BadgeProps } from "~/components/ui/badge";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Leave balances · ShiftCraft" };
export const dynamic = "force-dynamic";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const EMPLOYMENT_BADGE: Record<ScEmploymentType, BadgeVariant> = {
  full_time: "live",
  part_time: "open",
  casual: "warn",
  contractor: "neutral",
};

const EMPLOYMENT_LABEL: Record<ScEmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  casual: "Casual",
  contractor: "Contractor",
};

// 7.6h = the AU full-time standard day used by the balance engine, so
// the days conversion here matches lib/leave-balances.ts.
const HOURS_PER_DAY = 7.6;

function asDays(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  return `${(hours / HOURS_PER_DAY).toFixed(1)}d`;
}

export default async function TeamLeavePage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  // Active roster — every employee gets a row. Inactive rows are hidden
  // (they don't accrue and would just be noise on a balances overview).
  const roster = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        fullName: scEmployees.fullName,
        employmentType: scEmployees.employmentType,
        department: scDepartments.name,
      })
      .from(scEmployees)
      .leftJoin(scDepartments, eq(scDepartments.id, scEmployees.departmentId))
      .where(
        and(
          eq(scEmployees.traceyTenantId, tenantId),
          eq(scEmployees.isActive, true),
        ),
      )
      .orderBy(asc(scEmployees.fullName)),
  );

  // sc_employee → Xero employee id, for the authoritative column.
  const links = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        scEmployeeId: scXeroEmployeeLinks.scEmployeeId,
        xeroEmployeeId: scXeroEmployeeLinks.xeroEmployeeId,
      })
      .from(scXeroEmployeeLinks)
      .where(eq(scXeroEmployeeLinks.traceyTenantId, tenantId)),
  );
  const xeroIdByEmployee = new Map(
    links.map((l) => [l.scEmployeeId, l.xeroEmployeeId]),
  );

  // ShiftCraft estimate (reuse the existing engine) — one call per
  // employee, run in parallel. We only surface the `annual` line here.
  const scBalances = await Promise.all(
    roster.map((e) =>
      computeLeaveBalanceForEmployee({ tenantId, employeeId: e.id }).then(
        (bs) => bs.find((b) => b.slug === "annual") ?? null,
      ),
    ),
  );
  const scAnnualByEmployee = new Map<string, LeaveBalance | null>();
  roster.forEach((e, i) => scAnnualByEmployee.set(e.id, scBalances[i] ?? null));

  // Authoritative Xero column — only when Xero is configured + connected.
  const xeroConnected =
    isXeroConfigured() && (await loadConnection(tenantId)) != null;
  let xeroByEmployee = new Map<string, XeroAnnualLeave>();
  if (xeroConnected) {
    const linkedXeroIds = roster
      .map((e) => xeroIdByEmployee.get(e.id))
      .filter((v): v is string => v != null);
    const byXeroId = await fetchAnnualLeaveBalances(tenantId, linkedXeroIds);
    xeroByEmployee = new Map(
      roster
        .map((e) => {
          const xid = xeroIdByEmployee.get(e.id);
          const bal = xid ? byXeroId.get(xid) : undefined;
          return bal ? ([e.id, bal] as const) : null;
        })
        .filter((v): v is [string, XeroAnnualLeave] => v != null),
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Leave balances
          <InfoPopover label="About leave balances">
            <p>
              Each employee&rsquo;s <strong>annual-leave</strong> balance, shown
              two ways:
            </p>
            <p className="mt-1">
              <strong>ShiftCraft estimate</strong> — accrued from approved
              timesheets (hours worked × the annual accrual rate) minus
              approved leave taken. It&rsquo;s an estimate: casual &amp;
              contractor staff show zero (loading sits in their hourly rate),
              and leave taken is counted as business-days × 7.6h.
            </p>
            <p className="mt-1">
              <strong>Xero</strong> — the authoritative payroll figure read live
              from each linked Xero employee. This is the number that drives
              payslips. Differences between the two columns are expected; Xero
              wins.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Annual leave for everyone on the roster — ShiftCraft&rsquo;s estimate
          next to Xero&rsquo;s authoritative balance.
        </p>
      </div>

      {!xeroConnected && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-4 py-2 text-sm text-ink">
          Xero isn&rsquo;t connected, so only ShiftCraft&rsquo;s estimate is
          shown.{" "}
          <Link href="/app/admin/payroll" className="font-medium underline">
            Connect Xero on the Payroll page
          </Link>{" "}
          to see authoritative balances.
        </div>
      )}

      <section className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-[var(--paper)] shadow-[var(--shadow-sm)]">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-line bg-[var(--paper-2)] px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
          <div>Employee</div>
          <div className="text-right">ShiftCraft estimate</div>
          <div className="min-w-[8rem] text-right">Xero (authoritative)</div>
        </div>
        {roster.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-2">
            No active employees on the roster yet.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {roster.map((e) => {
              const sc = scAnnualByEmployee.get(e.id) ?? null;
              const xid = xeroIdByEmployee.get(e.id);
              const xero = xeroByEmployee.get(e.id);
              const empType = e.employmentType as ScEmploymentType;
              return (
                <li
                  key={e.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {e.fullName}
                      </span>
                      <Badge variant={EMPLOYMENT_BADGE[empType]} size="sm">
                        {EMPLOYMENT_LABEL[empType]}
                      </Badge>
                    </div>
                    {e.department && (
                      <div className="truncate text-xs text-ink-3">
                        {e.department}
                      </div>
                    )}
                  </div>

                  {/* ShiftCraft estimate */}
                  <div className="text-right text-xs leading-snug">
                    {sc ? (
                      <>
                        <div className="font-mono text-sm font-semibold tabular-nums text-ink">
                          {fmtHours(sc.availableHours)}
                          <span className="ml-1 font-sans text-[10px] font-normal text-ink-3">
                            {asDays(sc.availableHours)}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                          Accrued {fmtHours(sc.accruedHours)} · Taken{" "}
                          {fmtHours(sc.takenHours)}
                        </div>
                      </>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </div>

                  {/* Xero authoritative */}
                  <div className="min-w-[8rem] text-right text-xs leading-snug">
                    {!xeroConnected ? (
                      <span className="text-ink-3">—</span>
                    ) : !xid ? (
                      <span className="text-ink-3">Not linked</span>
                    ) : xero?.hours != null ? (
                      <div className="font-mono text-sm font-semibold tabular-nums text-ink">
                        {fmtHours(xero.hours)}
                        <span className="ml-1 font-sans text-[10px] font-normal text-ink-3">
                          {asDays(xero.hours)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
