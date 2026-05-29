import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { forTenant, scLocations, scShiftTemplates } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Shift templates · ShiftCraft" };

function fmtTime(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtDuration(
  startH: number,
  startM: number,
  endH: number,
  endM: number,
): string {
  let startMins = startH * 60 + startM;
  let endMins = endH * 60 + endM;
  // Overnight: treat end < start as next-day end.
  if (endMins <= startMins) endMins += 24 * 60;
  const total = endMins - startMins;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default async function ShiftTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");

  const { added } = await searchParams;
  const tenantId = membership.tenant.id;

  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scShiftTemplates.id,
        name: scShiftTemplates.name,
        role: scShiftTemplates.role,
        startHour: scShiftTemplates.startHour,
        startMinute: scShiftTemplates.startMinute,
        endHour: scShiftTemplates.endHour,
        endMinute: scShiftTemplates.endMinute,
        defaultNotes: scShiftTemplates.defaultNotes,
        locationName: scLocations.name,
        locationColor: scLocations.color,
      })
      .from(scShiftTemplates)
      .innerJoin(
        scLocations,
        eq(scLocations.id, scShiftTemplates.locationId),
      )
      .where(eq(scShiftTemplates.traceyTenantId, tenantId))
      .orderBy(asc(scShiftTemplates.name)),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Shift templates
            <InfoPopover label="About shift templates">
              <p>
                Saved shift patterns (location, role, time-of-day, notes)
                managers stamp onto a specific date. Combines the
                template&rsquo;s time-of-day with the chosen day on the{" "}
                <strong>New shift</strong> form.
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Save common shift patterns (location, role, time-of-day, notes).
            On <Link href="/app/schedule/new" className="text-primary hover:underline">New shift</Link>,
            pick a template and a date — the form prefills the rest.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/shift-templates/new">New template</Link>
        </Button>
      </div>

      {added === "1" && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          Template saved.
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No templates yet. Create one to skip the repetitive form-filling
            when you're building next week's roster.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
                style={
                  r.locationColor
                    ? { boxShadow: `inset 3px 0 0 ${r.locationColor}` }
                    : undefined
                }
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {r.locationColor && (
                      <span
                        aria-hidden
                        className="h-2 w-2 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: r.locationColor }}
                      />
                    )}
                    <span>{r.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {fmtDuration(
                        r.startHour,
                        r.startMinute,
                        r.endHour,
                        r.endMinute,
                      )}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.role} @ {r.locationName} ·{" "}
                    {fmtTime(r.startHour, r.startMinute)} – {fmtTime(r.endHour, r.endMinute)}
                    {r.defaultNotes ? ` · ${r.defaultNotes}` : ""}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/shift-templates/${r.id}/edit`}>Edit</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
