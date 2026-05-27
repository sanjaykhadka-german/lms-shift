import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import {
  forTenant,
  scDocuments,
  scEmployees,
  users as appUsers,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";
import {
  classifyDocuments,
  EXPIRY_WARN_DAYS,
  TIER_LABELS,
  type ExpiryTier,
} from "~/lib/document-expiry";
import { sendExpiryDigestAction } from "./actions";

export const metadata = { title: "Expiring documents · ShiftCraft" };
export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtRemaining(days: number): string {
  if (days < 0) {
    const n = Math.abs(days);
    return `${n} day${n === 1 ? "" : "s"} ago`;
  }
  if (days === 0) return "today";
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

const TIER_TONE: Record<ExpiryTier, string> = {
  expired: "border-rose-500/40 bg-rose-50/60 dark:bg-rose-950/20",
  lte7: "border-orange-500/40 bg-orange-50/60 dark:bg-orange-950/20",
  lte14: "border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20",
  lte30: "border-yellow-500/40 bg-yellow-50/60 dark:bg-yellow-950/20",
};

const TIER_BADGE: Record<ExpiryTier, string> = {
  expired: "bg-rose-600 text-white",
  lte7: "bg-orange-600 text-white",
  lte14: "bg-amber-600 text-white",
  lte30: "bg-yellow-600 text-white",
};

export default async function ExpiringDocumentsPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  // Pull every doc with an expiry that's already passed or within the
  // warning horizon. Joined to sc_employees + users so each row in the
  // table can show whose cert is lapsing.
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + EXPIRY_WARN_DAYS + 1);

  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scDocuments.id,
        title: scDocuments.title,
        scope: scDocuments.scope,
        employeeId: scDocuments.employeeId,
        expiresAt: scDocuments.expiresAt,
        ownerName: appUsers.name,
        ownerEmail: appUsers.email,
      })
      .from(scDocuments)
      .leftJoin(scEmployees, eq(scEmployees.id, scDocuments.employeeId))
      .leftJoin(appUsers, eq(appUsers.id, scEmployees.appUserId))
      .where(
        and(
          eq(scDocuments.traceyTenantId, tenantId),
          isNotNull(scDocuments.expiresAt),
          lte(scDocuments.expiresAt, horizon),
        ),
      )
      .orderBy(asc(scDocuments.expiresAt)),
  );

  const classified = classifyDocuments(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      scope: r.scope as "team" | "library",
      employeeId: r.employeeId,
      expiresAt: r.expiresAt,
    })),
  );

  // Build a lookup so the render layer can show owner info per row.
  const ownerByDoc = new Map(
    rows.map((r) => [
      r.id,
      {
        ownerName: r.ownerName,
        ownerEmail: r.ownerEmail,
        scope: r.scope as "team" | "library",
        employeeId: r.employeeId,
        expiresAt: r.expiresAt,
      },
    ]),
  );

  const tierOrder: ExpiryTier[] = ["expired", "lte7", "lte14", "lte30"];

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
            Expiring documents
            <InfoPopover label="About the expiry digest">
              <p>
                Every document with an `expires_at` within {EXPIRY_WARN_DAYS}{" "}
                days (or already past) lands here, bucketed by urgency. The
                team-documents page handles the day-to-day filter; this
                page exists so you can fan out a notification + email
                digest to every owner/admin in one click.
              </p>
              <p className="mt-1">
                There&rsquo;s no cron — pick a cadence (weekly is typical)
                and trigger from this button. The digest is silent when
                the list is empty.
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {classified.total === 0
              ? "Nothing expiring in the next 30 days. Clean state."
              : `${classified.total} document${classified.total === 1 ? "" : "s"} need attention.`}
          </p>
        </div>
        <form action={sendExpiryDigestAction}>
          <Button type="submit" size="sm" disabled={classified.total === 0}>
            Send digest now
          </Button>
        </form>
      </div>

      {/* Per-tier summary chips */}
      <div className="grid gap-3 sm:grid-cols-4">
        {tierOrder.map((tier) => {
          const count = classified.byTier[tier].length;
          return (
            <div
              key={tier}
              className={`rounded-lg border px-4 py-3 ${TIER_TONE[tier]}`}
            >
              <div className="text-2xl font-semibold tabular-nums">{count}</div>
              <div className="text-xs uppercase tracking-wider">
                {TIER_LABELS[tier]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-tier listing */}
      {tierOrder.map((tier) => {
        const items = classified.byTier[tier];
        if (items.length === 0) return null;
        return (
          <section
            key={tier}
            className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
          >
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TIER_BADGE[tier]}`}
              >
                {TIER_LABELS[tier]}
              </span>
              <span className="text-xs text-muted-foreground">
                {items.length} document{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {items.map((c) => {
                const owner = ownerByDoc.get(c.doc.id);
                return (
                  <li
                    key={c.doc.id}
                    className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{c.doc.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.doc.scope === "team" && owner?.ownerName ? (
                          <>
                            <span>{owner.ownerName}</span>
                            {owner.ownerEmail ? (
                              <span className="text-muted-foreground/70">
                                {" "}
                                · {owner.ownerEmail}
                              </span>
                            ) : null}
                          </>
                        ) : c.doc.scope === "team" ? (
                          <span>(employee record incomplete)</span>
                        ) : (
                          <span>Library</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 text-right">
                      <span className="font-mono tabular-nums text-sm">
                        {fmtDate(c.doc.expiresAt)}
                      </span>
                      <span
                        className={`text-xs font-medium tabular-nums ${
                          c.tier === "expired"
                            ? "text-rose-600"
                            : c.tier === "lte7"
                              ? "text-orange-600"
                              : c.tier === "lte14"
                                ? "text-amber-600"
                                : "text-yellow-700"
                        }`}
                      >
                        {fmtRemaining(c.daysRemaining ?? 0)}
                      </span>
                    </div>
                    {c.doc.scope === "team" && owner?.employeeId && (
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/app/employees/${owner.employeeId}/edit`}
                        >
                          Manage
                        </Link>
                      </Button>
                    )}
                    {c.doc.scope === "library" && (
                      <Button asChild size="sm" variant="outline">
                        <Link href="/app/people/documents">Open</Link>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <p className="text-[11px] text-muted-foreground">
        Day-to-day filter: <Link href="/app/people/team-documents?expiring=1" className="underline">team documents → Expiring in 30 days</Link>.
        Library docs with expiry are managed at <Link href="/app/people/documents" className="underline">/app/people/documents</Link>.
      </p>
    </div>
  );
}
