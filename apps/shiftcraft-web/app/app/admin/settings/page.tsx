import { redirect } from "next/navigation";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import {
  getTenantHolidayRegion,
  HOLIDAY_REGIONS,
  HOLIDAY_REGION_LABELS,
} from "~/lib/holidays";
import { HolidayRegionForm } from "./_form";

export const metadata = { title: "Workspace settings · ShiftCraft" };
export const dynamic = "force-dynamic";

export default async function WorkspaceSettingsPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");

  const currentRegion = await getTenantHolidayRegion(membership.tenant.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Workspace settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Settings shared across everyone in this workspace. Only Managers
          and Admins can change them.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Public holiday calendar</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick the Australian state or territory your workspace operates
          in. We&rsquo;ll combine that state&rsquo;s gazetted public
          holidays with the national ones. The choice will drive penalty
          rates, leave overlap warnings, and roster cost variance once
          those features ship.
        </p>
        <div className="mt-4">
          <HolidayRegionForm
            currentRegion={currentRegion}
            regions={HOLIDAY_REGIONS}
            labels={HOLIDAY_REGION_LABELS}
          />
        </div>
      </section>
    </div>
  );
}
