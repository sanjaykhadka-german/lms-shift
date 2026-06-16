import { redirect } from "next/navigation";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { forTenant, scVisitorSignins } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";
import { adminSignOutVisitorAction } from "./actions";

export const metadata = { title: "Visitors · ShiftCraft" };
export const dynamic = "force-dynamic";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function VisitorsAdminPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;
  const today = startOfToday();

  const [history, totalTodayRows, signedOutTodayRows] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scVisitorSignins.id,
          visitorName: scVisitorSignins.visitorName,
          visitorCompany: scVisitorSignins.visitorCompany,
          visitorMobile: scVisitorSignins.visitorMobile,
          visitingPerson: scVisitorSignins.visitingPerson,
          visitReason: scVisitorSignins.visitReason,
          signedInAt: scVisitorSignins.signedInAt,
          signedOutAt: scVisitorSignins.signedOutAt,
        })
        .from(scVisitorSignins)
        .where(eq(scVisitorSignins.traceyTenantId, tenantId))
        .orderBy(desc(scVisitorSignins.signedInAt))
        .limit(200),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ c: count() })
        .from(scVisitorSignins)
        .where(
          and(
            eq(scVisitorSignins.traceyTenantId, tenantId),
            gte(scVisitorSignins.signedInAt, today),
          ),
        ),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ c: count() })
        .from(scVisitorSignins)
        .where(
          and(
            eq(scVisitorSignins.traceyTenantId, tenantId),
            gte(scVisitorSignins.signedOutAt, today),
          ),
        ),
    ),
  ]);

  const signedIn = history.filter((v) => !v.signedOutAt);
  const totalToday = totalTodayRows[0]?.c ?? 0;
  const signedOutToday = signedOutTodayRows[0]?.c ?? 0;

  const stats = [
    { label: "Signed in now", value: signedIn.length },
    { label: "Arrived today", value: totalToday },
    { label: "Departed today", value: signedOutToday },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Visitors
            <InfoPopover label="About visitors">
              <p>
                Reception sign-in logbook. Visitors sign in (and out) at any
                paired kiosk under <strong>Visitor? Sign in here</strong>.
                Records here are tenant-wide across all locations.
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who's on site and the full visit history. Export to CSV for your
            records.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="/app/admin/visitors/export">Export CSV</a>
        </Button>
      </div>

      <section className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-border bg-card p-4 shadow-sm"
          >
            <div className="text-2xl font-semibold text-ink">{s.value}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {s.label}
            </div>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Currently signed in</h2>
        </div>
        {signedIn.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No visitors are on site right now.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {signedIn.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">
                    {v.visitorName}
                    {v.visitorCompany ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {v.visitorCompany}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    visiting {v.visitingPerson} · {v.visitorMobile} · since{" "}
                    {fmtDateTime(v.signedInAt)}
                  </div>
                </div>
                <form action={adminSignOutVisitorAction}>
                  <input type="hidden" name="id" value={v.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Sign out
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            Visit history{" "}
            <span className="text-xs font-normal text-muted-foreground">
              (latest {history.length})
            </span>
          </h2>
        </div>
        {history.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No visits recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-2 font-medium">Visitor</th>
                  <th className="px-3 py-2 font-medium">Visiting</th>
                  <th className="px-3 py-2 font-medium">Signed in</th>
                  <th className="px-3 py-2 font-medium">Signed out</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((v) => (
                  <tr key={v.id}>
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-ink">
                        {v.visitorName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {v.visitorCompany ? `${v.visitorCompany} · ` : ""}
                        {v.visitorMobile}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{v.visitingPerson}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {fmtDateTime(v.signedInAt)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {fmtDateTime(v.signedOutAt)}
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          v.signedOutAt
                            ? "bg-[var(--ink-3)] text-white"
                            : "bg-[var(--live)] text-white"
                        }`}
                      >
                        {v.signedOutAt ? "Signed out" : "On site"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
