import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, members, users as appUsers, type Role } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import {
  ROLE_DESCRIPTIONS,
  friendlyRoleLabel,
} from "~/lib/roles";
import { Avatar } from "~/components/Avatar";

export const metadata = { title: "Team · ShiftCraft" };

// Per-tier visual treatment. Tailwind v4's themed palette renders
// bg-X-50 + text-X-900 as a low-contrast tint pair, so the card header
// band uses a solid mid-tone fill with white text instead. The body
// below the band falls back to the regular card background.
const ROLE_THEME: Record<
  Role,
  { headerBg: string; badgeBg: string; border: string; accent: string }
> = {
  owner: {
    headerBg: "bg-indigo-600",
    badgeBg: "bg-indigo-900/40",
    border: "border-indigo-200 dark:border-indigo-900/40",
    accent: "bg-indigo-600",
  },
  admin: {
    headerBg: "bg-blue-600",
    badgeBg: "bg-blue-900/40",
    border: "border-blue-200 dark:border-blue-900/40",
    accent: "bg-blue-600",
  },
  member: {
    headerBg: "bg-slate-600",
    badgeBg: "bg-slate-900/40",
    border: "border-border",
    accent: "bg-slate-500",
  },
};

const ROLES_IN_ORDER: Role[] = ["owner", "admin", "member"];

export default async function TeamPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const roster = await db
    .select({
      memberId: members.id,
      role: members.role,
      joinedAt: members.createdAt,
      userId: appUsers.id,
      name: appUsers.name,
      email: appUsers.email,
      image: appUsers.image,
    })
    .from(members)
    .innerJoin(appUsers, eq(appUsers.id, members.userId))
    .where(eq(members.tenantId, membership.tenant.id))
    .orderBy(asc(appUsers.name), asc(appUsers.email));

  // Group by role for a "tier list" feel.
  const byRole = new Map<Role, typeof roster>();
  for (const r of roster) {
    const key = r.role as Role;
    const arr = byRole.get(key) ?? [];
    arr.push(r);
    byRole.set(key, arr);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who's in {membership.tenant.name} and what each tier can do.
          Managers can invite, revoke, or change roles from{" "}
          <Link
            href="/app/admin/members"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Members
          </Link>
          .
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        {ROLES_IN_ORDER.map((role) => {
          const desc = ROLE_DESCRIPTIONS[role];
          const theme = ROLE_THEME[role];
          return (
            <div
              key={role}
              className={`overflow-hidden rounded-lg border bg-card shadow-sm ${theme.border}`}
            >
              <div
                className={`flex items-center justify-between gap-2 px-4 py-3 text-white ${theme.headerBg}`}
              >
                <div>
                  <h3 className="text-base font-semibold leading-tight">
                    {desc.label}
                  </h3>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-white/70">
                    role: {desc.underlying}
                  </div>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white ${theme.badgeBg}`}
                >
                  Tier
                </span>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">{desc.blurb}</p>
                <ul className="mt-3 space-y-1.5 text-xs">
                  {desc.can.map((line) => (
                    <li key={line} className="flex items-start gap-1.5">
                      <span className="mt-px text-emerald-600 dark:text-emerald-400">
                        ✓
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                  {desc.cannot.map((line) => (
                    <li
                      key={line}
                      className="flex items-start gap-1.5 text-muted-foreground"
                    >
                      <span className="mt-px text-[color:var(--destructive)]">
                        ✕
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">All members ({roster.length})</h2>
        </div>
        {ROLES_IN_ORDER.map((role) => {
          const rows = byRole.get(role) ?? [];
          if (rows.length === 0) return null;
          const theme = ROLE_THEME[role];
          return (
            <div key={role} className="border-t border-border first:border-t-0">
              <div className="flex items-center gap-2 bg-muted/30 px-5 py-2">
                <span aria-hidden className={`h-2 w-2 rounded-full ${theme.accent}`} />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {friendlyRoleLabel(role)}
                </span>
                <span className="text-xs text-muted-foreground/70">
                  · {rows.length}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <li
                    key={r.memberId}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        name={r.name}
                        email={r.email}
                        image={r.image}
                        sizeClass="h-8 w-8"
                        textClass="text-xs"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {r.name ?? r.email}
                        </div>
                        {r.name && (
                          <div className="truncate text-xs text-muted-foreground">
                            {r.email}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Joined{" "}
                      {r.joinedAt.toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}
