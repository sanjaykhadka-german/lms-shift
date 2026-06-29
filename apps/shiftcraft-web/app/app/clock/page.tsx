import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { forTenant, scLocations, type ScClockEventType } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import {
  aggregateClockTotals,
  fmtHours,
  getLatestEventForUser,
  getTodayEventsForUser,
  stateFor,
} from "~/lib/clock";
import { closeStaleClockInForUser } from "~/lib/clock-sweep";
import { ClockPanel } from "./_panel";
import { getClockPolicy } from "~/lib/clock-policy";
import { Badge } from "~/components/ui/badge";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Time clock · ShiftCraft" };

const EVENT_BADGE: Record<string, "live" | "warn" | "neutral" | "open"> = {
  in: "live",
  out: "neutral",
  break_start: "warn",
  break_end: "open",
};

export default async function ClockPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const tenantId = membership.tenant.id;

  // Self-heal BEFORE reading the latest event: if this user has a forgotten
  // punch that's already 24h+ stale, auto-close it now so the page shows the
  // correct "Clock in" prompt rather than a stale "clocked in since …" state.
  // Best-effort; no-op when nothing is stale.
  await closeStaleClockInForUser(tenantId, user.id);

  const [events, latestEvent, locations, clockPolicy] = await Promise.all([
    getTodayEventsForUser(tenantId, user.id),
    getLatestEventForUser(tenantId, user.id),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name })
        .from(scLocations)
        .where(eq(scLocations.traceyTenantId, tenantId))
        .orderBy(asc(scLocations.name)),
    ),
    getClockPolicy(tenantId),
  ]);

  // Current status must come from the user's *latest* event regardless of
  // calendar day. recordPunch() validates the transition against the
  // all-time last event, so deriving from today-only would show a "Clock
  // in" button to someone who never clocked out yesterday — which the
  // server then rejects with "You're already clocked in."
  const status = stateFor(latestEvent?.eventType as ScClockEventType | undefined);
  const realSegmentStart =
    status === "clocked_out" ? null : (latestEvent?.occurredAt ?? null);

  // Live-timer anchor: clamp a segment that began before today to midnight
  // so "Worked today" reflects only today's portion — a forgotten overnight
  // clock-out shouldn't read as an 18-hour day. For a normal same-day
  // segment this equals realSegmentStart.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const timerAnchor =
    realSegmentStart && realSegmentStart < startOfToday
      ? startOfToday
      : realSegmentStart;

  // Today's already-closed work, up to the live segment's anchor. The
  // client adds live ticks on top via Date.now().
  const closedEvents =
    status === "clocked_out" || !timerAnchor
      ? events
      : events.filter((e) => e.occurredAt < timerAnchor);
  const baseTotals = aggregateClockTotals(closedEvents);

  // Find the most recent location used today; pre-select it for convenience.
  const lastLocation = [...events]
    .reverse()
    .find((e) => e.locationId != null)?.locationId ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
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
        <p className="mt-1 text-sm text-ink-2">
          Punch in when you start, take breaks as needed, punch out when
          you're done. Today's events feed your timesheet automatically.
        </p>
      </div>

      {!clockPolicy.allowWebClock ? (
        <div className="rounded-[var(--r-lg)] border border-line bg-[var(--paper)] p-5 text-sm text-ink-2 shadow-[var(--shadow-sm)]">
          Web clock-in is turned off for this workspace. Please clock in at a
          kiosk device.
        </div>
      ) : (
        <>
          {clockPolicy.allowUnscheduledClockIn ? (
            <div className="rounded-[var(--r-sm)] border border-line-soft bg-paper-2 px-4 py-3 text-xs text-ink-2">
              <strong className="text-ink">Starting an unscheduled shift?</strong>{" "}
              Just clock in as normal — if you&rsquo;re not rostered right now
              we&rsquo;ll flag it on your timesheet for a manager to review.
            </div>
          ) : null}
          <ClockPanel
            status={status}
            segmentStartedAtIso={timerAnchor?.toISOString() ?? null}
            locations={locations}
            defaultLocationId={lastLocation}
            baseWorkMs={baseTotals.workMs}
            baseBreakMs={baseTotals.breakMs}
          />
        </>
      )}

      <section className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-[var(--paper)] shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
          <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
            Today's punches
          </h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
            {events.length} {events.length === 1 ? "event" : "events"} ·{" "}
            {fmtHours(baseTotals.workMs)} closed
          </span>
        </div>
        {events.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-2">
            No punches yet today. Clock in to start.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {events.map((e) => {
              const loc = locations.find((l) => l.id === e.locationId);
              return (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs tabular-nums text-ink-3">
                      {e.occurredAt.toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <Badge variant={EVENT_BADGE[e.eventType] ?? "neutral"} size="sm">
                      {eventLabel(e.eventType)}
                    </Badge>
                  </div>
                  <span className="text-xs text-ink-2">
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
