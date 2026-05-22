import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import {
  auditEvents,
  db,
  forTenant,
  invitations,
  members,
  scEmployees,
  users,
  type Role,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager, friendlyRoleLabel, ROLE_DESCRIPTIONS } from "~/lib/roles";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";
import { InviteForm } from "./_invite_form";
import { RevokeInvitationButton } from "./_revoke";
import { revokeInvitationAction } from "./actions";

export const metadata = { title: "Members · ShiftCraft" };
export const dynamic = "force-dynamic";

const ROLES_IN_ORDER: Role[] = ["owner", "admin", "member"];

const ROLE_ACCENT: Record<Role, string> = {
  owner: "bg-indigo-600",
  admin: "bg-blue-600",
  member: "bg-slate-500",
};

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-indigo-600 text-white",
  admin: "bg-blue-600 text-white",
  member: "bg-slate-500 text-white",
};

// Same audit-tone palette used by /app/audit/page.tsx — mirrored here so
// the embedded mini-log feels consistent without importing from a sibling
// route file.
function actionTone(action: string): string {
  if (action.endsWith(".deleted") || action.endsWith(".revoked")) {
    return "bg-red-600 text-white";
  }
  if (action.endsWith(".approved")) return "bg-emerald-600 text-white";
  if (action.endsWith(".disputed")) return "bg-amber-500 text-white";
  if (
    action.endsWith(".created") ||
    action.endsWith(".added") ||
    action.endsWith(".invited") ||
    action.endsWith(".paired") ||
    action.endsWith(".restored")
  ) {
    return "bg-blue-600 text-white";
  }
  return "bg-slate-500 text-white";
}

function fmtWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtJoined(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function MembersAdminPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  // Member list — auth-side with role + joined-at, plus the linked
  // sc_employees.id (when present) so each row gets a Manage button to
  // /app/employees/<sc-id>/edit where the Kiosk PIN + Role cards live.
  const memberRows = await db
    .select({
      memberId: members.id,
      role: members.role,
      joinedAt: members.createdAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.tenantId, tenantId))
    .orderBy(asc(users.name), asc(users.email));

  // Resolve sc_employees.id for each auth user that has one. Lives in the
  // per-tenant schema — use forTenant. Returns a map for O(1) lookup
  // during render.
  const scLinks = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        appUserId: scEmployees.appUserId,
      })
      .from(scEmployees)
      .where(eq(scEmployees.traceyTenantId, tenantId)),
  );
  const scIdByUserId = new Map<string, string>();
  for (const link of scLinks) {
    if (link.appUserId) scIdByUserId.set(link.appUserId, link.id);
  }

  // Group memberRows by role for the tier-list display.
  const byRole = new Map<Role, typeof memberRows>();
  for (const r of memberRows) {
    const key = r.role as Role;
    const arr = byRole.get(key) ?? [];
    arr.push(r);
    byRole.set(key, arr);
  }

  // Pending invitations (newest first).
  const pending = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(eq(invitations.tenantId, tenantId))
    .orderBy(desc(invitations.createdAt));

  // Mini audit log — last 50 events for this tenant. Full log lives at
  // /app/audit; this view is a quick "what's happened in workspace
  // administration lately" widget for managers.
  const recentAudit = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorEmail: auditEvents.actorEmail,
      targetKind: auditEvents.targetKind,
      targetId: auditEvents.targetId,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(50);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who has access to {membership.tenant.name}. Invite teammates, manage
          their workspace role, and revoke pending invitations from one place.
        </p>
      </div>

      {/* ─── Invite form ─── */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Invite a teammate</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          They'll get an email with a link to join. Invitations expire in 7
          days.
        </p>
        <div className="mt-4">
          <InviteForm />
        </div>
      </section>

      {/* ─── Member list ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            All members ({memberRows.length})
          </h2>
        </div>
        {ROLES_IN_ORDER.map((role) => {
          const rows = byRole.get(role) ?? [];
          if (rows.length === 0) return null;
          const desc = ROLE_DESCRIPTIONS[role];
          return (
            <div key={role} className="border-t border-border first:border-t-0">
              <div className="flex items-center gap-2 bg-muted/30 px-5 py-2">
                <span
                  aria-hidden
                  className={`h-2 w-2 rounded-full ${ROLE_ACCENT[role]}`}
                />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {desc.label}
                </span>
                <span className="text-xs text-muted-foreground/70">
                  · {rows.length}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {rows.map((r) => {
                  const scId = scIdByUserId.get(r.userId);
                  return (
                    <li
                      key={r.memberId}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar
                          name={r.name}
                          email={r.email}
                          image={r.image}
                          sizeClass="h-9 w-9"
                          textClass="text-xs"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {r.name ?? r.email}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {r.name ? r.email : null}
                            {r.name ? " · " : ""}
                            Joined {fmtJoined(r.joinedAt)}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ROLE_BADGE[r.role] ?? "bg-muted text-muted-foreground"}`}
                        >
                          {friendlyRoleLabel(r.role)}
                        </span>
                        {scId ? (
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/app/employees/${scId}/edit`}>
                              Manage
                            </Link>
                          </Button>
                        ) : (
                          <Button asChild variant="outline" size="sm">
                            <Link
                              href={`/app/employees/new?email=${encodeURIComponent(r.email)}&fullName=${encodeURIComponent(r.name ?? "")}`}
                            >
                              Add to roster
                            </Link>
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      {/* ─── Pending invitations ─── */}
      {pending.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold">
              Pending invitations ({pending.length})
            </h2>
          </div>
          <ul className="divide-y divide-border">
            {pending.map((inv) => {
              const expired = inv.expiresAt.getTime() < Date.now();
              return (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {inv.email}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {expired ? (
                        <span className="text-amber-600">Expired</span>
                      ) : (
                        <>Expires {fmtJoined(inv.expiresAt)}</>
                      )}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ROLE_BADGE[inv.role] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {friendlyRoleLabel(inv.role)}
                  </span>
                  <form action={revokeInvitationAction}>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <RevokeInvitationButton />
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* ─── Recent audit (last 50) ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Recent activity</h2>
          <Link
            href="/app/audit"
            className="text-xs text-muted-foreground hover:underline"
          >
            Full audit log →
          </Link>
        </div>
        {recentAudit.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No recorded activity in this workspace yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recentAudit.map((r) => (
              <li key={r.id} className="space-y-1 px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${actionTone(r.action)}`}
                  >
                    {r.action}
                  </span>
                  {r.targetKind ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.targetKind}
                      {r.targetId ? `:${r.targetId.slice(0, 8)}` : ""}
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmtWhen(r.createdAt)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.actorEmail ?? "system"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
