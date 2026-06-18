import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNotNull } from "drizzle-orm";
import { forTenant, scEmployees } from "@tracey/db";
import { checkRateFloor } from "@tracey/award";
import { currentMembership } from "~/lib/auth/current";
import { isWorkspaceAdmin } from "~/lib/roles";
import { getTenantAwardMeta } from "~/lib/award-profile";
import {
  listClassifications,
  resolveCurrent,
} from "~/lib/award-classifications";
import { fmtIsoDate } from "~/lib/clock";
import { FloorToggle } from "./_floor_toggle";
import { ClassificationsCard } from "./_classifications";
import { AssignmentsCard } from "./_assignments";

export const metadata = { title: "Award classifications · ShiftCraft" };
export const dynamic = "force-dynamic";

export default async function AwardsAdminPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isWorkspaceAdmin(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  const meta = await getTenantAwardMeta(tenantId);
  const today = fmtIsoDate(new Date());

  const [classifications, employees] = await Promise.all([
    listClassifications(tenantId, meta.awardCode ?? ""),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scEmployees.id,
          fullName: scEmployees.fullName,
          employmentType: scEmployees.employmentType,
          hourlyRate: scEmployees.hourlyRate,
          awardLevelCode: scEmployees.awardLevelCode,
        })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            eq(scEmployees.isActive, true),
            isNotNull(scEmployees.appUserId),
          ),
        ),
    ),
  ]);

  const current = resolveCurrent(classifications, today);
  const levelOptions = [...current.values()]
    .map((c) => ({ levelCode: c.levelCode, label: c.label }))
    .sort((a, b) => a.levelCode.localeCompare(b.levelCode));

  const employeeRows = employees.map((e) => {
    const hourlyRate = e.hourlyRate == null ? null : Number(e.hourlyRate);
    const cls = e.awardLevelCode ? current.get(e.awardLevelCode) : undefined;
    const floor = cls
      ? checkRateFloor({
          hourlyRate,
          baseHourlyRate: cls.baseHourlyRate,
          casualLoading: cls.casualLoading,
          isCasual: e.employmentType === "casual",
        })
      : null;
    return {
      id: e.id,
      fullName: e.fullName,
      employmentType: e.employmentType,
      hourlyRate,
      awardLevelCode: e.awardLevelCode,
      floor,
    };
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Award classifications
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Minimum hourly rates per classification level, and the level each
          team member is on. Rates pulled from Fair Work (or entered by hand)
          drive the under-minimum check. ShiftCraft never computes tax or
          super — these are pay floors, not payslips.
        </p>
      </div>

      {!meta.awardCode ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          No award selected yet. Pick your Modern Award in{" "}
          <Link
            href="/app/admin/settings"
            className="font-medium underline underline-offset-2"
          >
            Workspace settings → Award profile
          </Link>{" "}
          first; classifications attach to it.
        </div>
      ) : (
        <>
          <FloorToggle block={meta.awardFloorBlock} />
          <ClassificationsCard
            awardCode={meta.awardCode}
            classifications={classifications}
            today={today}
          />
          <AssignmentsCard
            employees={employeeRows}
            levelOptions={levelOptions}
            floorBlock={meta.awardFloorBlock}
          />
        </>
      )}
    </div>
  );
}
