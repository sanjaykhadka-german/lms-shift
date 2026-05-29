import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMembership, currentUser } from "~/lib/auth/current";
import {
  getRecentNotifications,
  type FeedNotification,
} from "~/lib/notifications-feed";
import { Button } from "~/components/ui/button";
import { markAllReadAction, markReadAction } from "./actions";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Notifications · ShiftCraft" };

function fmtWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const KIND_TONE: Record<string, string> = {
  shiftcraft_employee_added: "bg-[var(--accent-deep)] text-[var(--accent-ink)]",
  shiftcraft_shift_claimed: "bg-[var(--live)] text-white",
};

function toneFor(kind: string): string {
  return KIND_TONE[kind] ?? "bg-[var(--ink-3)] text-white";
}

export default async function NotificationsPage() {
  const me = await currentUser();
  if (!me) redirect("/sign-in");
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;

  const rows = await getRecentNotifications(tenantId, me.id, 100);
  const unread = rows.filter((r) => r.readAt == null);
  const read = rows.filter((r) => r.readAt != null);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Notifications
            <InfoPopover label="About notifications">
              <p>
                Your bell-icon feed — every in-app notification routed to
                you. Email + web-push toggles live in{" "}
                <a href="/app/settings" className="underline">
                  Settings
                </a>
                .
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {unread.length > 0
              ? `${unread.length} unread`
              : "You're all caught up."}{" "}
            · Last 100 entries shown.
          </p>
        </div>
        {unread.length > 0 && (
          <form action={markAllReadAction}>
            <Button type="submit" variant="outline" size="sm">
              Mark all as read
            </Button>
          </form>
        )}
      </div>

      {unread.length > 0 && (
        <Section title="Unread" rows={unread} highlight />
      )}
      {read.length > 0 && <Section title="Earlier" rows={read} />}

      {rows.length === 0 && (
        <section className="rounded-lg border border-border bg-card px-5 py-8 text-center">
          <p className="text-sm font-medium">Nothing here yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            We'll let you know when something happens that needs your
            attention — shift offers, swap requests, posted announcements,
            and so on.
          </p>
        </section>
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  highlight,
}: {
  title: string;
  rows: FeedNotification[];
  highlight?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li
            key={r.id}
            className={
              "flex items-start justify-between gap-3 px-5 py-3 " +
              (highlight ? "bg-[color-mix(in_srgb,var(--warn)_6%,transparent)]" : "")
            }
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                    toneFor(r.kind)
                  }
                >
                  {r.kind.replace(/^shiftcraft_/, "").replace(/_/g, " ")}
                </span>
                <span className="text-sm font-medium">{r.title}</span>
              </div>
              {r.body && (
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {r.body}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                {fmtWhen(r.createdAt)}
                {r.readAt
                  ? ` · read ${fmtWhen(r.readAt)}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {r.actionUrl && (
                <Button asChild size="sm" variant="outline">
                  <Link href={r.actionUrl}>Open</Link>
                </Button>
              )}
              {r.readAt == null && (
                <form action={markReadAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <Button type="submit" size="sm">
                    Mark read
                  </Button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
