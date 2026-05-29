import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, tenants, members, users } from "@tracey/db";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

const statusVariant = {
  trialing: "warning",
  active: "success",
  past_due: "destructive",
  canceled: "secondary",
} as const;

export default async function PlatformTenantsPage() {
  const memberCountSubquery = db
    .select({
      tenantId: members.tenantId,
      count: sql<number>`count(*)::int`.as("member_count"),
    })
    .from(members)
    .groupBy(members.tenantId)
    .as("member_counts");

  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      plan: tenants.plan,
      status: tenants.status,
      trialEndsAt: tenants.trialEndsAt,
      currentPeriodEnd: tenants.currentPeriodEnd,
      seatsPurchased: tenants.seatsPurchased,
      createdAt: tenants.createdAt,
      ownerEmail: users.email,
      memberCount: memberCountSubquery.count,
    })
    .from(tenants)
    .leftJoin(users, eq(users.id, tenants.ownerUserId))
    .leftJoin(memberCountSubquery, eq(memberCountSubquery.tenantId, tenants.id))
    .orderBy(desc(tenants.createdAt));

  return (
    <div className="mx-auto max-w-[1800px] px-4 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tenants</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          All workspaces signed up across Tracey.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{rows.length} {rows.length === 1 ? "tenant" : "tenants"}</CardTitle>
          <CardDescription>Newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border)] text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                  <th className="pb-2 pr-3 font-medium">Workspace</th>
                  <th className="pb-2 pr-3 font-medium">Owner</th>
                  <th className="pb-2 pr-3 font-medium">Plan</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Renews</th>
                  <th className="pb-2 pr-3 font-medium">Members</th>
                  <th className="pb-2 pr-3 font-medium">Seats</th>
                  <th className="pb-2 pr-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {rows.map((r) => {
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="py-3 pr-3">
                        <Link
                          href={`/platform/tenants/${r.id}`}
                          className="font-medium hover:underline"
                        >
                          {r.name}
                        </Link>
                        <div className="text-xs text-[color:var(--muted-foreground)]">{r.slug}</div>
                      </td>
                      <td className="py-3 pr-3 text-[color:var(--muted-foreground)]">{r.ownerEmail ?? "—"}</td>
                      <td className="py-3 pr-3">
                        <span className="capitalize">{r.plan}</span>
                      </td>
                      <td className="py-3 pr-3">
                        <Badge
                          variant={statusVariant[r.status as keyof typeof statusVariant] ?? "secondary"}
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-3 pr-3 text-[color:var(--muted-foreground)]">
                        {r.currentPeriodEnd?.toISOString().slice(0, 10) ?? "—"}
                      </td>
                      <td className="py-3 pr-3">{r.memberCount ?? 0}</td>
                      <td className="py-3 pr-3">{r.seatsPurchased ?? 0}</td>
                      <td className="py-3 pr-3 text-[color:var(--muted-foreground)]">
                        {r.createdAt.toISOString().slice(0, 10)}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-[color:var(--muted-foreground)]">
                      No tenants yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
