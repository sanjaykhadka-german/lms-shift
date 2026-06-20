import { redirect } from "next/navigation";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { maybeSweepStaleClockIns } from "~/app/app/timesheets/event-actions";
import { loadWhosClockedIn } from "~/lib/whos-clocked-in";
import { Avatar } from "~/components/Avatar";
import { Badge } from "~/components/ui/badge";
import { InfoPopover } from "~/components/InfoPopover";
import { AutoRefresh } from "./_auto-refresh";

export const metadata = { title: "Who's clocked in now · ShiftCraft" };
export const dynamic = "force-dynamic";

// Sessions running longer than this are flagged so a manager can chase a
// forgotten punch (the auto clock-out only fires 24h after a scheduled start).
const LONG_SHIFT_MS = 10 * 60 * 60 * 1000;

function fmtClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function fmtElapsed(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function ClockedInNowPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  // Auto-close any forgotten punches first so they don't show as falsely "in"
  // (same throttled sweep the clock/kiosk/timesheets pages run).
  await maybeSweepStaleClockIns(tenantId);

  const people = await loadWhosClockedIn(tenantId);
  const now = Date.now();
  const working = people.filter((p) => p.status === "working").length;
  const onBreak = people.filter((p) => p.status === "on_break").length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <AutoRefresh />
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Who&rsquo;s clocked in now
          <InfoPopover label="About this view">
            <p>
              Everyone currently on shift across all locations, live from the
              web clock + kiosks. Refreshes every 30s. Long sessions are
              flagged so you can chase a forgotten punch.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {people.length} on shift · {working} working · {onBreak} on break
        </p>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">On shift ({people.length})</h2>
        </div>
        {people.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            Nobody is clocked in right now.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {people.map((p) => {
              const longShift = now - new Date(p.clockedInIso).getTime() > LONG_SHIFT_MS;
              return (
                <li
                  key={p.userId}
                  className="flex items-center justify-between gap-4 px-5 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      name={p.name}
                      email=""
                      image={p.image}
                      sizeClass="h-9 w-9"
                      textClass="text-xs"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">
                        {p.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[p.departmentName, p.locationName]
                          .filter(Boolean)
                          .join(" · ") || "No location"}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3 text-right">
                    <div className="text-xs text-muted-foreground">
                      <div className="tabular-nums text-ink">
                        {fmtElapsed(p.clockedInIso, now)}
                        {longShift ? (
                          <span className="ml-1 text-[var(--warn)]">long</span>
                        ) : null}
                      </div>
                      <div>since {fmtClock(p.clockedInIso)}</div>
                    </div>
                    {p.status === "working" ? (
                      <Badge variant="live" size="sm" dot>
                        Working
                      </Badge>
                    ) : (
                      <Badge variant="warn" size="sm">
                        On break
                      </Badge>
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
