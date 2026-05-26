import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { forTenant, scLocations } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import {
  aggregateClockTotals,
  deriveClockState,
  fmtHours,
  getTodayEventsForUser,
} from "~/lib/clock";
import { ClockPanel } from "./_panel";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Time clock · ShiftCraft" };

export default async function ClockPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const tenantId = membership.tenant.id;

  const [events, locations] = await Promise.all([
    getTodayEventsForUser(tenantId, user.id),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name })
        .from(scLocations)
        .where(eq(scLocations.traceyTenantId, tenantId))
        .orderBy(asc(scLocations.name)),
    ),
  ]);

  const state = deriveClockState(events);

  // Totals for today *up to the start of the current open segment*. The
  // client adds live ticks on top via Date.now().
  const closedEvents =
    state.status === "clocked_out" || !state.segmentStartedAt
      ? events
      : events.filter((e) => e.occurredAt < state.segmentStartedAt!);
  const baseTotals = aggregateClockTotals(closedEvents);

  // Find the most recent location used today; pre-select it for convenience.
  const lastLocation = [...events]
    .reverse()
    .find((e) => e.locationId != null)?.locationId ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
          Time clock
          <InfoPopover label="About clocking in">
            <p>
              Tap <strong>In</strong>, <strong>Break</strong>, or{" "}
              <strong>Out</strong> — every event is appended to your
              clock stream and drives this week&rsquo;s timesheet.
            </p>
            <p className="mt-1">
              Selfies are optional but help managers verify punches. On a
              kiosk device the buttons authenticate with a PIN instead.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Punch in when you start, take breaks as needed, punch out when
          you're done. Today's events feed your timesheet automatically.
        </p>
      </div>

      <ClockPanel
        status={state.status}
        segmentStartedAtIso={state.segmentStartedAt?.toISOString() ?? null}
        locations={locations}
        defaultLocationId={lastLocation}
        baseWorkMs={baseTotals.workMs}
        baseBreakMs={baseTotals.breakMs}
      />

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Today's punches</h2>
          <span className="text-xs text-muted-foreground">
            {events.length} {events.length === 1 ? "event" : "events"} ·{" "}
            {fmtHours(baseTotals.workMs)} closed work
          </span>
        </div>
        {events.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No punches yet today. Clock in to start.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e) => {
              const loc = locations.find((l) => l.id === e.locationId);
              return (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 px-5 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground">
                      {e.occurredAt.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <span className="text-sm">{eventLabel(e.eventType)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {loc ? loc.name : ""}
                    {loc && e.notes ? " · " : ""}
                    {e.notes ?? ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function eventLabel(t: string): string {
  switch (t) {
    case "in":
      return "Clocked in";
    case "out":
      return "Clocked out";
    case "break_start":
      return "Started break";
    case "break_end":
      return "Ended break";
    default:
      return t;
  }
}
