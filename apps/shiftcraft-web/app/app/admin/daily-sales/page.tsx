import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";
import {
  addDays,
  fmtIsoDate,
  parseIsoDate,
  startOfWeek,
} from "~/lib/clock";
import {
  aggregateSalesByDate,
  listDailySales,
  listLocationsLite,
} from "~/lib/daily-sales";
import { DailySaleRowForm } from "./_row-form";

export const metadata = { title: "Daily sales · ShiftCraft" };
export const dynamic = "force-dynamic";

const AUD = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function fmtWeekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default async function DailySalesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; location?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");

  const { week, location: locFilterRaw } = await searchParams;
  const tenantId = membership.tenant.id;
  const weekStart = startOfWeek(parseIsoDate(week) ?? new Date());
  const weekEnd = addDays(weekStart, 7);
  const startIso = fmtIsoDate(weekStart);
  const endIso = fmtIsoDate(weekEnd);
  const prevWeekParam = fmtIsoDate(addDays(weekStart, -7));
  const nextWeekParam = fmtIsoDate(addDays(weekStart, 7));

  const [allLocations, rows] = await Promise.all([
    listLocationsLite(tenantId),
    listDailySales(tenantId, startIso, endIso),
  ]);

  const locationFilter = locFilterRaw && locFilterRaw !== "" ? locFilterRaw : null;
  const visibleLocations = locationFilter
    ? allLocations.filter((l) => l.id === locationFilter)
    : allLocations;

  const salesByDate = aggregateSalesByDate(rows);
  // Map (locationId, date) -> { gross, notes } so the per-row form
  // picks up the current value cleanly.
  const lookup = new Map<string, { gross: string; notes: string | null }>();
  for (const r of rows) {
    lookup.set(`${r.locationId}|${r.businessDate}`, {
      gross: r.grossSales,
      notes: r.notes,
    });
  }

  const days: string[] = [];
  for (let i = 0; i < 7; i += 1) days.push(fmtIsoDate(addDays(weekStart, i)));
  const weekTotal = Array.from(salesByDate.values()).reduce(
    (s, d) => s + d.total,
    0,
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Daily sales
          <InfoPopover label="About daily sales">
            <p>
              Manually-keyed revenue per (location, day). Powers the{" "}
              <strong>Wages vs sales</strong> card on{" "}
              <a href="/app/reports" className="underline">
                Reports
              </a>{" "}
              and the labour-cost % calculation.
            </p>
            <p className="mt-1">
              No POS feed in v1 — enter the day&rsquo;s gross sales
              manually. Re-saving the same day overwrites; clear
              removes the row entirely.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Key in each day&rsquo;s gross revenue per location. Drives the
          wages-vs-sales card on Reports. No POS feed yet — enter manually.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/app/admin/daily-sales?week=${prevWeekParam}${locationFilter ? `&location=${locationFilter}` : ""}`}
            >
              ← Previous week
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/app/admin/daily-sales${locationFilter ? `?location=${locationFilter}` : ""}`}
            >
              This week
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/app/admin/daily-sales?week=${nextWeekParam}${locationFilter ? `&location=${locationFilter}` : ""}`}
            >
              Next week →
            </Link>
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Week starting</span>
          <span className="font-medium tabular-nums">{startIso}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold tabular-nums">
            {AUD.format(weekTotal)}
          </span>
        </div>
      </div>

      {allLocations.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Location:</span>
          <Button asChild size="sm" variant={locationFilter ? "outline" : "default"}>
            <Link href={`/app/admin/daily-sales?week=${startIso}`}>All</Link>
          </Button>
          {allLocations.map((l) => (
            <Button
              key={l.id}
              asChild
              size="sm"
              variant={locationFilter === l.id ? "default" : "outline"}
            >
              <Link href={`/app/admin/daily-sales?week=${startIso}&location=${l.id}`}>
                {l.name}
              </Link>
            </Button>
          ))}
        </div>
      )}

      {visibleLocations.length === 0 ? (
        <section className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          <p>No locations yet — create one before entering daily sales.</p>
        </section>
      ) : (
        <div className="space-y-4">
          {visibleLocations.map((loc) => {
            const locTotal = days.reduce((s, d) => {
              const v = Number(
                lookup.get(`${loc.id}|${d}`)?.gross ?? "0",
              );
              return s + (Number.isFinite(v) ? v : 0);
            }, 0);
            return (
              <section
                key={loc.id}
                className="rounded-lg border border-border bg-card shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <div className="flex items-center gap-2">
                    {loc.color && (
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: loc.color }}
                      />
                    )}
                    <h2 className="text-sm font-semibold">{loc.name}</h2>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {AUD.format(locTotal)}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {days.map((d) => {
                    const cell = lookup.get(`${loc.id}|${d}`);
                    return (
                      <li
                        key={`${loc.id}-${d}`}
                        className="flex items-start gap-3 px-5 py-2"
                      >
                        <div className="w-20 pt-1.5 text-xs font-medium text-muted-foreground">
                          {fmtWeekday(d)}
                        </div>
                        <div className="flex-1">
                          <DailySaleRowForm
                            key={`${loc.id}-${d}`}
                            locationId={loc.id}
                            businessDate={d}
                            initialGross={cell?.gross ?? ""}
                            initialNotes={cell?.notes ?? null}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
