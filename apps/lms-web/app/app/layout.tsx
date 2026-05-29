import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  currentMembership,
  currentUser,
  listUserTenants,
} from "~/lib/auth/current";
import { findPendingInvitationForEmail } from "~/lib/auth/invitations";
import { siteConfig } from "~/lib/site-config";
import { getAuthorAccess } from "~/lib/auth/author";
import { isPlatformAdmin } from "~/lib/auth/platform";
import { getOrProvisionLmsUser } from "~/lib/lms/learner";
import { accessLevelFor } from "~/lib/billing/access";
import { UserMenu } from "./_components/user-menu";
import { TenantSwitcher } from "./_components/tenant-switcher";
import { MobileMenu } from "./_components/mobile-menu";
import { GlobalSearch } from "./_components/global-search";
import { NotificationBell } from "./_components/notification-bell";
import { ReadOnlyBanner } from "./_components/read-only-banner";
import { InstallAppButton } from "~/components/pwa/InstallAppButton";
import { TooltipProvider } from "~/components/ui/tooltip";

// Pages that must remain reachable when a tenant is `blocked`. The billing
// page is the re-subscribe escape hatch. Sign-out is a server action invoked
// from the user menu without rendering through this layout, so it does not
// need an exemption here.
const BILLING_GATE_EXEMPT = ["/app/billing"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in?returnTo=/app");

  const membership = await currentMembership();
  if (!membership) {
    const pending = await findPendingInvitationForEmail(user.email);
    if (pending) {
      redirect(`/accept-invite?token=${encodeURIComponent(pending.token)}`);
    }
    redirect("/onboarding");
  }

  const platformAdmin = isPlatformAdmin(user.email);
  const accessLevel = platformAdmin ? "full" : accessLevelFor(membership.tenant);

  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  const exempt = BILLING_GATE_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (accessLevel === "blocked" && !exempt) {
    redirect("/app/billing");
  }

  const tenants = await listUserTenants();
  const switcherOptions = tenants.map((m) => ({
    id: m.tenant.id,
    name: m.tenant.name,
    role: m.role,
  }));
  const authorAccess = await getAuthorAccess();
  const lmsUser = await getOrProvisionLmsUser({
    traceyUserId: user.id,
    traceyTenantId: membership.tenant.id,
    email: user.email,
    name: user.name,
  });
  const photoUrl = lmsUser.photoFilename
    ? `/uploads/${lmsUser.photoFilename}`
    : null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 w-full border-b border-[color:var(--border)] bg-[color:var(--background)]/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1800px] items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <MobileMenu
              isAdminOrOwner={membership.role === "owner" || membership.role === "admin"}
            />
            <Link href="/app" className="flex items-center" aria-label={siteConfig.name}>
              <span
                className="text-[2.7rem] leading-none tracking-tight"
                style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
              >
                {/* The accented "a" turns emerald when workspace Audit Mode is
                    ON. Deliberately unlabelled — an auditor watching the
                    screen sees only a brand colour, the admin who set the
                    toggle knows what it means. */}
                tr
                <span
                  className={
                    membership.tenant.auditMode
                      ? "text-emerald-500"
                      : "text-[color:var(--primary)]"
                  }
                >
                  a
                </span>
                cey
              </span>
            </Link>
            <TenantSwitcher
              active={{
                id: membership.tenant.id,
                name: membership.tenant.name,
                role: membership.role,
              }}
              options={switcherOptions}
            />
            {authorAccess && <GlobalSearch />}
            <nav className="hidden items-center gap-1 sm:flex">
              <Link
                href="/app/my/modules"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
              >
                Training
              </Link>
              <Link
                href="/app/members"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
              >
                Team
              </Link>
              {(membership.role === "owner" || membership.role === "admin") && (
                <Link
                  href="/app/billing"
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
                >
                  Billing
                </Link>
              )}
              {(membership.role === "owner" || membership.role === "admin") && (
                <Link
                  href="/app/admin"
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
                >
                  Admin
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <InstallAppButton />
            <UserMenu
              name={user.name}
              email={user.email}
              photoUrl={photoUrl}
              showPlatformLink={platformAdmin}
            />
          </div>
        </div>
      </header>
      {accessLevel === "read_only" && (
        <ReadOnlyBanner
          status={membership.tenant.status}
          trialEndsAt={membership.tenant.trialEndsAt?.toISOString() ?? null}
          currentPeriodEnd={membership.tenant.currentPeriodEnd?.toISOString() ?? null}
          timezone={membership.tenant.timezone}
        />
      )}
      <main className="flex-1 bg-gradient-to-b from-[color:var(--background)] via-[color:var(--background)] to-[color:var(--primary)]/[0.06]">{children}</main>
    </div>
    </TooltipProvider>
  );
}
