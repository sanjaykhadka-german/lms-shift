import { redirect } from "next/navigation";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isPlatformAdmin } from "~/lib/auth/platform-allowlist";
import {
  getRecentNotifications,
  getUnreadCount,
} from "~/lib/notifications-feed";
import { Sidebar } from "~/components/Sidebar";
import { TopBar } from "~/components/TopBar";
import {
  NotificationsBell,
  type NotificationPreview,
} from "~/components/NotificationsBell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in?returnTo=/app");

  const membership = await currentMembership();
  const displayName = user.name ?? user.email;
  const roleLabel = membership?.role ?? "member";
  // Platform-admin check is server-side (reads PLATFORM_ADMIN_EMAILS); pass a
  // boolean to the client Sidebar so it can show the cross-tenant link.
  const platformAdmin = isPlatformAdmin(user.email);
  // Unread count + 5 recent notifications power the top-right bell.
  // Both are tenant-scoped via the same recipientUserId, so we run them
  // in parallel. Skip the query if there's no active membership (user
  // just signed up — they have no tenant context yet).
  const [unreadCount, recentRows] = membership
    ? await Promise.all([
        getUnreadCount(membership.tenant.id, user.id),
        getRecentNotifications(membership.tenant.id, user.id, 5),
      ])
    : [0, []];
  const recent: NotificationPreview[] = recentRows.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    actionUrl: n.actionUrl,
    readAt: n.readAt?.toISOString() ?? null,
    createdAtIso: n.createdAt.toISOString(),
  }));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        name={displayName}
        email={user.email}
        image={user.image}
        role={roleLabel}
        showPlatformLink={platformAdmin}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Global chrome — only renders on md+ so the existing mobile
            top-bar in Sidebar.tsx isn't doubled up. */}
        <TopBar
          tenantName={membership?.tenant.name ?? null}
          bell={<NotificationsBell unreadCount={unreadCount} recent={recent} />}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
