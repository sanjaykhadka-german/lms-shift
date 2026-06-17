import { redirect } from "next/navigation";
import { currentMembership } from "~/lib/auth/current";
import { isWorkspaceAdmin } from "~/lib/roles";
import {
  getTenantHolidayRegion,
  HOLIDAY_REGIONS,
  HOLIDAY_REGION_LABELS,
} from "~/lib/holidays";
import { getTenantAwardProfile } from "~/lib/award-profile";
import { HolidayRegionForm } from "./_form";
import { InfoPopover } from "~/components/InfoPopover";
import { AwardProfileForm } from "./_award_form";

export const metadata = { title: "Workspace settings · ShiftCraft" };
export const dynamic = "force-dynamic";

export default async function WorkspaceSettingsPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  // Workspace settings are owner/Manager only — Location Managers are scoped
  // to their site and can't change tenant-wide config.
  if (!isWorkspaceAdmin(membership.role)) redirect("/app");

  const [currentRegion, awardProfile] = await Promise.all([
    getTenantHolidayRegion(membership.tenant.id),
    getTenantAwardProfile(membership.tenant.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Workspace settings
          <InfoPopover label="About workspace settings">
            <p>
              Tenant-wide knobs. The AU public-holiday region drives
              penalty rates on timesheets + leave-overlap warnings. The
              award profile overrides the package defaults the timesheet
              classifier uses to split hours into ordinary / OT / penalty.
            </p>
          </InfoPopover>
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

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Award profile</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Override the Modern Award general-rule defaults the classifier
          uses to compute ordinary / overtime hours and penalty rates.
          Leave any field blank to use the AU baseline shown as the
          placeholder. Changes apply to all future timesheet renders.
        </p>
        <div className="mt-4">
          <AwardProfileForm currentProfile={awardProfile} />
        </div>
      </section>
    </div>
  );
}
