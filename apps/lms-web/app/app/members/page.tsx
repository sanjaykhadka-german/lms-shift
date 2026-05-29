import { eq, desc } from "drizzle-orm";
import { db, invitations, members, users } from "@tracey/db";
import { requireTenant } from "~/lib/auth/current";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { PageHeader } from "~/components/page-header";
import { InviteForm } from "./_form";
import { RevokeButton } from "./_revoke";
import { revokeInvitationAction } from "./actions";

export default async function MembersPage() {
  const { tenant, role } = await requireTenant();
  const canManage = role === "owner" || role === "admin";

  const memberRows = await db
    .select({
      id: members.id,
      role: members.role,
      createdAt: members.createdAt,
      userId: users.id,
      name: users.name,
      email: users.email,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.tenantId, tenant.id))
    .orderBy(desc(members.createdAt));

  const pending = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(eq(invitations.tenantId, tenant.id))
    .orderBy(desc(invitations.createdAt));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <PageHeader
        title="Team"
        description={`Manage who can access ${tenant.name}.`}
      />

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Invite a teammate</CardTitle>
            <CardDescription>
              They&rsquo;ll get an email with a link to join. Invitations expire in
              7 days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Members ({memberRows.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[color:var(--border)]">
          {memberRows.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {m.name ?? m.email}
                </div>
                <div className="text-xs text-[color:var(--muted-foreground)] truncate">
                  {m.email}
                </div>
              </div>
              <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                {m.role}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending invitations ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-[color:var(--border)]">
            {pending.map((inv) => {
              const expired = inv.expiresAt.getTime() < Date.now();
              return (
                <div key={inv.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{inv.email}</div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      {expired ? "Expired" : `Expires ${inv.expiresAt.toISOString().slice(0, 10)}`}
                    </div>
                  </div>
                  <Badge variant="outline">{inv.role}</Badge>
                  {canManage && (
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <RevokeButton />
                    </form>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
