import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  auditEvents,
  db,
  forTenant,
  invitations,
  members,
  scClockEvents,
  scEmployees,
  scKioskDevices,
  scLocations,
  tenants,
  users,
} from "@tracey/db";
import { friendlyRoleLabel } from "~/lib/roles";

export const metadata = { title: "Tenant · Platform" };
export const dynamic = "force-dynamic";

function fmtWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STATUS_BADGE: Record<string, string> = {
  owner: "bg-[var(--accent)] text-[var(--accent-ink)]",
  admin: "bg-[var(--accent-deep)] text-[var(--accent-ink)]",
  member: "bg-[var(--ink-3)] text-white",
};

function kioskBadge(d: {
  revokedAt: Date | null;
  pairedAt: Date | null;
}): { label: string; classes: string } {
  if (d.revokedAt) return { label: "Revoked", classes: "bg-[var(--ink-3)] text-white" };
  if (d.pairedAt) return { label: "Active", classes: "bg-[var(--live)] text-white" };
  return { label: "Awaiting pair", classes: "bg-[var(--accent-deep)] text-[var(--accent-ink)]" };
}

function actionTone(action: string): string {
  if (action.endsWith(".deleted") || action.endsWith(".revoked")) {
    return "bg-[var(--danger)] text-white";
  }
  if (action.endsWith(".approved")) return "bg-[var(--live)] text-white";
  if (action.endsWith(".disputed")) return "bg-[var(--warn)] text-white";
  if (
    action.endsWith(".created") ||
    action.endsWith(".added") ||
    action.endsWith(".invited") ||
    action.endsWith(".paired") ||
    action.endsWith(".restored")
  ) {
    return "bg-[var(--accent-deep)] text-[var(--accent-ink)]";
  }
  return "bg-[var(--ink-3)] text-white";
}

export default async function PlatformTenantDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: tenantId } = await params;

  const [tenant] = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      plan: tenants.plan,
      status: tenants.status,
      createdAt: tenants.createdAt,
      ownerEmail: users.email,
    })
    .from(tenants)
    .leftJoin(users, eq(users.id, tenants.ownerUserId))
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) notFound();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Cross-schema fan-out: app.* tables get one big Promise.all on `db`,
  // per-tenant sc_* counts + lists go inside one forTenant.run() so the
  // RLS GUC + search_path are set once.
  const [
    memberRows,
    pendingInvites,
    auditRows,
    perTenant,
  ] = await Promise.all([
    db
      .select({
        memberId: members.id,
        role: members.role,
        joinedAt: members.createdAt,
        userId: users.id,
        name: users.name,
        email: users.email,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.tenantId, tenantId))
      .orderBy(desc(members.createdAt)),
    db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(eq(invitations.tenantId, tenantId))
      .orderBy(desc(invitations.createdAt)),
    db
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
      .limit(50),
    forTenant(tenantId).run((tx) =>
      Promise.all([
        tx
          .select({ c: sql<number>`count(*)::int` })
          .from(scLocations)
          .where(eq(scLocations.traceyTenantId, tenantId)),
        tx
          .select({ c: sql<number>`count(*)::int` })
          .from(scEmployees)
          .where(eq(scEmployees.traceyTenantId, tenantId)),
        tx
          .select({ c: sql<number>`count(*)::int` })
          .from(scClockEvents)
          .where(
            and(
              eq(scClockEvents.traceyTenantId, tenantId),
              gte(scClockEvents.occurredAt, sevenDaysAgo),
            ),
          ),
        tx
          .select({
            id: scKioskDevices.id,
            label: scKioskDevices.label,
            locationId: scKioskDevices.locationId,
            pairedAt: scKioskDevices.pairedAt,
            lastSeenAt: scKioskDevices.lastSeenAt,
            revokedAt: scKioskDevices.revokedAt,
            requireSelfie: scKioskDevices.requireSelfie,
          })
          .from(scKioskDevices)
          .where(eq(scKioskDevices.traceyTenantId, tenantId))
          .orderBy(desc(scKioskDevices.createdAt)),
        tx
          .select({
            id: scClockEvents.id,
            appUserId: scClockEvents.appUserId,
            eventType: scClockEvents.eventType,
            source: scClockEvents.source,
            occurredAt: scClockEvents.occurredAt,
          })
          .from(scClockEvents)
          .where(eq(scClockEvents.traceyTenantId, tenantId))
          .orderBy(desc(scClockEvents.occurredAt))
          .limit(20),
      ]),
    ),
  ]);

  const [
    [{ c: locationCount = 0 } = { c: 0 }],
    [{ c: employeeCount = 0 } = { c: 0 }],
    [{ c: punchCount = 0 } = { c: 0 }],
    kioskList,
    recentPunches,
  ] = perTenant;

  // Resolve user names for the recent-punches list — one round trip
  // against app.users.
  const punchUserIds = Array.from(
    new Set(recentPunches.map((p) => p.appUserId)),
  );
  const punchUserNames =
    punchUserIds.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await db
              .select({ id: users.id, name: users.name, email: users.email })
              .from(users)
              .where(sql`${users.id} in ${punchUserIds}`)
          ).map((u) => [u.id, u.name ?? u.email ?? "—"]),
        );

  const activeKioskCount = kioskList.filter((k) => !k.revokedAt).length;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-10">
      <div>
        <Link
          href="/platform/tenants"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← All tenants
        </Link>
        <h1 className="mt-1 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          {tenant.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-mono">{tenant.slug}</span> · owner{" "}
          {tenant.ownerEmail ?? "—"} · {tenant.plan} · {tenant.status}
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-5">
        <Stat label="Members" value={memberRows.length} />
        <Stat label="Locations" value={locationCount} />
        <Stat label="Employees" value={employeeCount} />
        <Stat label="Active kiosks" value={activeKioskCount} />
        <Stat label="Punches (7d)" value={punchCount} />
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            Members ({memberRows.length})
          </h2>
        </div>
        <ul className="divide-y divide-border">
          {memberRows.map((m) => (
            <li
              key={m.memberId}
              className="flex items-center justify-between gap-3 px-5 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {m.name ?? m.email}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {m.email} · joined {fmtDate(m.joinedAt)}
                </div>
              </div>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE[m.role] ?? "bg-muted text-muted-foreground"}`}
              >
                {friendlyRoleLabel(m.role)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {pendingInvites.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold">
              Pending invitations ({pendingInvites.length})
            </h2>
          </div>
          <ul className="divide-y divide-border">
            {pendingInvites.map((inv) => {
              const expired = inv.expiresAt.getTime() < Date.now();
              return (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-3 px-5 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {inv.email}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {expired ? (
                        <span className="text-[var(--warn)]">Expired</span>
                      ) : (
                        <>Expires {fmtDate(inv.expiresAt)}</>
                      )}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE[inv.role] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {friendlyRoleLabel(inv.role)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            Kiosks ({kioskList.length})
          </h2>
        </div>
        {kioskList.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No kiosks registered.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {kioskList.map((k) => {
              const b = kioskBadge(k);
              return (
                <li
                  key={k.id}
                  className="flex items-center justify-between gap-3 px-5 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {k.label}
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${b.classes}`}
                      >
                        {b.label}
                      </span>
                      {!k.requireSelfie ? (
                        <span className="inline-flex items-center rounded-full bg-[var(--ink-3)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                          Selfie off
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last seen{" "}
                      {k.lastSeenAt ? fmtWhen(k.lastSeenAt) : "never"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            Recent punches ({recentPunches.length})
          </h2>
        </div>
        {recentPunches.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No clock events yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recentPunches.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {punchUserNames.get(p.appUserId) ?? "Unknown"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.eventType} · source {p.source}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {fmtWhen(p.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Audit (last 50)</h2>
          <Link
            href={`/platform/audit?tenant=${tenant.id}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            Full log →
          </Link>
        </div>
        {auditRows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No audit events for this tenant yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {auditRows.map((r) => (
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
