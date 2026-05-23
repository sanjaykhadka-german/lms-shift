import { redirect } from "next/navigation";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { getUnreadCount } from "~/lib/notifications-feed";
import { Sidebar } from "~/components/Sidebar";
import { NotificationsBell } from "~/components/NotificationsBell";

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
  // Best-effort unread count for the bell badge. If there's no active
  // membership yet (user just signed up), default to 0 so we don't run
  // a tenant-scoped query.
  const unreadCount = membership
    ? await getUnreadCount(membership.tenant.id, user.id)
    : 0;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        name={displayName}
        email={user.email}
        image={user.image}
        role={roleLabel}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Global chrome — only renders on md+ so the existing mobile
            top-bar in Sidebar.tsx isn't doubled up. */}
        <header className="sticky top-0 z-30 hidden h-12 items-center justify-end border-b border-border bg-card/95 px-4 backdrop-blur md:flex">
          <NotificationsBell unreadCount={unreadCount} />
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
