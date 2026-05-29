import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, forTenant, scAnnouncements, users as appUsers } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { AnnouncementForm } from "./_form";
import { InfoPopover } from "~/components/InfoPopover";
import {
  deleteAnnouncementAction,
  togglePinnedAction,
} from "./actions";

export const metadata = { title: "Announcements · ShiftCraft" };

function fmtWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const { added } = await searchParams;
  const tenantId = membership.tenant.id;
  const isAdmin =
    membership.role === "owner" || membership.role === "admin";

  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scAnnouncements)
      .where(eq(scAnnouncements.traceyTenantId, tenantId))
      .orderBy(desc(scAnnouncements.pinned), desc(scAnnouncements.createdAt)),
  );

  const authorIds = Array.from(
    new Set(
      rows
        .map((r) => r.createdByUserId)
        .filter((v): v is string => !!v),
    ),
  );
  const authors = authorIds.length
    ? await db
        .select({
          id: appUsers.id,
          name: appUsers.name,
          email: appUsers.email,
        })
        .from(appUsers)
    : [];
  const authorById = new Map(
    authors.map((a) => [a.id, a.name ?? a.email]),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Announcements
          <InfoPopover label="About announcements">
            <p>
              Pinned messages that show on every worker&rsquo;s dashboard
              when they sign in. Use them for shift changes, holiday
              rosters, and anything time-sensitive.
            </p>
            <p className="mt-1">
              Tick <strong>Email blast</strong> on save to also fan out
              to every subscribed worker&rsquo;s inbox.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pinned messages show on the dashboard. Use them for shift changes,
          holiday rosters, and anything the team should see when they sign
          in.
        </p>
      </div>

      {isAdmin && (
        <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold">New announcement</h2>
          <p className="mt-1 mb-4 text-xs text-muted-foreground">
            Posted as you, visible to everyone in {membership.tenant.name}.
          </p>
          <AnnouncementForm />
        </section>
      )}

      {added === "1" && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          Announcement posted.
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            All announcements ({rows.length})
          </h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No announcements yet.
            {isAdmin ? " Post one above." : ""}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const expired =
                r.expiresAt && r.expiresAt.getTime() < Date.now();
              const author = r.createdByUserId
                ? authorById.get(r.createdByUserId)
                : null;
              return (
                <li key={r.id} className="space-y-2 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">{r.title}</h3>
                        {r.pinned && !expired && (
                          <span className="inline-flex items-center rounded-full bg-[var(--warn)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                            Pinned
                          </span>
                        )}
                        {expired && (
                          <span className="inline-flex items-center rounded-full bg-[var(--ink-3)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                            Expired
                          </span>
                        )}
                        {r.emailedAt && (
                          <span
                            className="inline-flex items-center rounded-full bg-[var(--accent-deep)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-ink)]"
                            title={`Sent to ${r.emailedRecipientCount ?? 0} ${r.emailedRecipientCount === 1 ? "person" : "people"} on ${fmtWhen(r.emailedAt)}`}
                          >
                            Emailed · {r.emailedRecipientCount ?? 0}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Posted {fmtWhen(r.createdAt)}
                        {author ? ` · by ${author}` : ""}
                        {r.expiresAt
                          ? ` · expires ${fmtWhen(r.expiresAt)}`
                          : ""}
                      </div>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{r.body}</p>
                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <form action={togglePinnedAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input
                          type="hidden"
                          name="pinned"
                          value={String(!r.pinned)}
                        />
                        <Button type="submit" variant="outline" size="sm">
                          {r.pinned ? "Unpin" : "Pin"}
                        </Button>
                      </form>
                      <form action={deleteAnnouncementAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          className="text-[color:var(--destructive)] border-[color:var(--destructive)]/40 hover:bg-[color:var(--destructive)]/10"
                        >
                          Delete
                        </Button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
