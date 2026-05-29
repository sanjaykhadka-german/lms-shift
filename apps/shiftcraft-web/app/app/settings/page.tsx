import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, users as appUsers } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import {
  EMAIL_KINDS,
  EMAIL_KIND_LABELS,
  getEmailPrefsForUser,
  type EmailKind,
} from "~/lib/email-prefs";
import { signFeedToken } from "~/lib/ics";
import { getVapidPublicKey, isWebPushConfigured } from "~/lib/web-push";
import { Button } from "~/components/ui/button";
import { toggleEmailPrefAction } from "./actions";
import { AvatarForm } from "./_avatar-form";
import { CalendarSubscription } from "./_calendar-subscription";
import { PasswordForm } from "./_password-form";
import { ProfileForm } from "./_profile-form";
import { PushSubscribeButton } from "./_push-subscribe";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Settings · ShiftCraft" };

export default async function SettingsPage() {
  const me = await currentUser();
  if (!me) redirect("/sign-in");
  const membership = await currentMembership();

  // Re-read the row so we always reflect the latest persisted state (the
  // session JWT may still hold the old name after a profile edit until the
  // user signs out and back in).
  const [row] = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      name: appUsers.name,
      image: appUsers.image,
      passwordHash: appUsers.passwordHash,
      passwordChangedAt: appUsers.passwordChangedAt,
    })
    .from(appUsers)
    .where(eq(appUsers.id, me.id))
    .limit(1);
  if (!row) redirect("/sign-in");

  const hasPassword = !!row.passwordHash;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Settings
          <InfoPopover label="About settings">
            <p>
              Personal profile, notification toggles (email + web push),
              calendar feed URL, password. Workspace-level knobs live in{" "}
              <a href="/app/admin/settings" className="underline">
                Workspace settings
              </a>
              .
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage how you appear and how you sign in.
          {membership && (
            <>
              {" "}
              Active workspace:{" "}
              <span className="font-medium">{membership.tenant.name}</span>.
            </>
          )}
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Avatar</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Shows up next to your name in the roster, schedule, and team
          page. No upload yet — paste a direct image URL (a Gravatar
          link, your LinkedIn photo, anything publicly hosted).
        </p>
        <AvatarForm
          email={row.email}
          name={row.name}
          currentImage={row.image}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Profile</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Your name appears on shifts, timesheets, tasks, and the roster.
        </p>
        <ProfileForm defaultName={row.name ?? ""} />
        <p className="mt-4 text-xs text-muted-foreground">
          Email: <span className="font-mono">{row.email}</span> — changing
          this would change your sign-in identity. Contact a workspace owner
          if you need to move accounts.
        </p>
      </section>

      {membership && (
        <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold">Email notifications</h2>
          <p className="mt-1 mb-4 text-xs text-muted-foreground">
            Choose which ShiftCraft emails you want for{" "}
            <span className="font-medium">{membership.tenant.name}</span>.
            Turning a category off won't affect in-app notifications — only
            email.
          </p>
          {await renderEmailPrefs(me.id, membership.tenant.id)}
        </section>
      )}

      {membership && isWebPushConfigured() && (
        <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold">Push notifications</h2>
          <p className="mt-1 mb-4 text-xs text-muted-foreground">
            Get a notification on this device whenever something needs
            your attention — shift offers, swap requests, time-off
            decisions, announcements. Independent of email; turn either
            on or off without affecting the other.
          </p>
          <PushSubscribeButton vapidPublicKey={getVapidPublicKey()!} />
        </section>
      )}

      {membership && (
        <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold">Calendar subscription</h2>
          <p className="mt-1 mb-4 text-xs text-muted-foreground">
            Subscribe to your accepted shifts in any calendar app
            (Google Calendar, Outlook, iOS Calendar). The URL is unique
            to you for{" "}
            <span className="font-medium">{membership.tenant.name}</span> —
            don't share it.
          </p>
          {await renderCalendarSubscription(me.id, membership.tenant.id)}
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold">Password</h2>
        {hasPassword ? (
          <>
            <p className="mt-1 mb-4 text-xs text-muted-foreground">
              Last changed{" "}
              {row.passwordChangedAt.toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
              . Changing it signs you out of any other sessions.
            </p>
            <PasswordForm />
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            This account doesn't have a password — you sign in via SSO.
            Password changes aren't available here.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Resolves the request's origin (so the feed URL is absolute and
 * copy-pasteable into calendar apps) and renders the subscription card.
 *
 * The origin comes from request headers rather than process.env so the
 * URL is correct whether we're on localhost:4100, a Render preview, or
 * prod. NEXT_PUBLIC_APP_URL would be cleaner, but isn't always wired in
 * the dev shell.
 */
async function renderCalendarSubscription(userId: string, tenantId: string) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:4100";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const token = signFeedToken(tenantId, userId);
  const feedUrl = `${proto}://${host}/api/calendar/${tenantId}/${userId}/${token}.ics`;
  return <CalendarSubscription feedUrl={feedUrl} />;
}

/**
 * Render the per-kind email preference toggles. Each row submits a tiny
 * form to the toggle action so we don't need a client component for
 * what is essentially a row of checkboxes.
 */
async function renderEmailPrefs(userId: string, tenantId: string) {
  const prefs = await getEmailPrefsForUser(tenantId, userId);
  return (
    <ul className="divide-y divide-border">
      {EMAIL_KINDS.map((kind: EmailKind) => {
        const enabled = prefs[kind];
        const label = EMAIL_KIND_LABELS[kind];
        return (
          <li
            key={kind}
            className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                {label.title}
                <span
                  className={
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                    (enabled
                      ? "bg-[var(--live)] text-white"
                      : "bg-[var(--ink-3)] text-white")
                  }
                >
                  {enabled ? "On" : "Off"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {label.blurb}
              </p>
            </div>
            <form action={toggleEmailPrefAction}>
              <input type="hidden" name="kind" value={kind} />
              <input
                type="hidden"
                name="enabled"
                value={enabled ? "false" : "true"}
              />
              <Button type="submit" variant="outline" size="sm">
                {enabled ? "Turn off" : "Turn on"}
              </Button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
