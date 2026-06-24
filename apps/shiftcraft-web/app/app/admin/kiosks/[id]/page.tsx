import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  scClockEventPhotos,
  scClockEvents,
  scKioskDevices,
  scLocations,
  users,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { SelfieThumb } from "~/components/SelfieThumb";
import {
  regeneratePairingCodeAction,
  restoreKioskAction,
  revokeKioskAction,
  toggleSelfieRequiredAction,
  toggleVisitorsAllowedAction,
} from "../actions";
import { DeleteKioskButton } from "../_delete_button";

export const metadata = { title: "Kiosk · ShiftCraft" };
export const dynamic = "force-dynamic";

const RECENT_PUNCH_LIMIT = 50;

function fmtAgo(d: Date | null): string {
  if (!d) return "never";
  const ms = Date.now() - d.getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

function eventBadgeClass(e: string): string {
  switch (e) {
    case "in":
      return "bg-[var(--live)] text-white";
    case "out":
      return "bg-[var(--danger)] text-white";
    case "break_start":
    case "break_end":
      return "bg-[var(--ink-3)] text-white";
    default:
      return "bg-[var(--ink-3)] text-white";
  }
}

function eventLabel(e: string): string {
  switch (e) {
    case "in":
      return "In";
    case "out":
      return "Out";
    case "break_start":
      return "Break →";
    case "break_end":
      return "← Break";
    default:
      return e;
  }
}

export default async function KioskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  const [device] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scKioskDevices.id,
        label: scKioskDevices.label,
        locationId: scKioskDevices.locationId,
        locationName: scLocations.name,
        pairingCode: scKioskDevices.pairingCode,
        pairingExpiresAt: scKioskDevices.pairingExpiresAt,
        pairedAt: scKioskDevices.pairedAt,
        lastSeenAt: scKioskDevices.lastSeenAt,
        revokedAt: scKioskDevices.revokedAt,
        requireSelfie: scKioskDevices.requireSelfie,
        allowVisitors: scKioskDevices.allowVisitors,
        createdAt: scKioskDevices.createdAt,
      })
      .from(scKioskDevices)
      .leftJoin(
        scLocations,
        eq(scLocations.id, scKioskDevices.locationId),
      )
      .where(
        and(
          eq(scKioskDevices.id, id),
          eq(scKioskDevices.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!device) notFound();

  // Recent kiosk punches at this device's location. Clock events don't
  // carry the deviceId (multiple kiosks at one location can't be told
  // apart in v1) so we filter by location + source='kiosk' as the
  // closest available proxy. Adding device_id to scClockEvents would
  // let us be exact — left for a future slice.
  const recentPunches = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scClockEvents.id,
        appUserId: scClockEvents.appUserId,
        eventType: scClockEvents.eventType,
        occurredAt: scClockEvents.occurredAt,
        selfieStatus: scClockEventPhotos.selfieStatus,
        hasImage: sql<boolean>`${scClockEventPhotos.image} is not null`,
      })
      .from(scClockEvents)
      .leftJoin(
        scClockEventPhotos,
        eq(scClockEventPhotos.clockEventId, scClockEvents.id),
      )
      .where(
        and(
          eq(scClockEvents.traceyTenantId, tenantId),
          eq(scClockEvents.locationId, device.locationId),
          eq(scClockEvents.source, "kiosk"),
        ),
      )
      .orderBy(desc(scClockEvents.occurredAt))
      .limit(RECENT_PUNCH_LIMIT),
  );

  // Batch-resolve user names from app.users so we don't N+1.
  const userIds = Array.from(new Set(recentPunches.map((p) => p.appUserId)));
  const peopleRows =
    userIds.length === 0
      ? []
      : await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
          })
          .from(users)
          .where(sql`${users.id} in ${userIds}`);
  const nameById = new Map(
    peopleRows.map((p) => [p.id, p.name ?? p.email ?? "—"] as const),
  );

  const codeExpired =
    !device.pairedAt &&
    !device.revokedAt &&
    device.pairingExpiresAt &&
    device.pairingExpiresAt.getTime() < Date.now();

  const status = device.revokedAt
    ? { label: "Revoked", classes: "bg-[var(--ink-3)] text-white" }
    : device.pairedAt
      ? { label: "Active", classes: "bg-[var(--live)] text-white" }
      : codeExpired
        ? { label: "Code expired", classes: "bg-[var(--warn)] text-white" }
        : { label: "Awaiting pair", classes: "bg-[var(--accent-deep)] text-[var(--accent-ink)]" };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/app/admin/kiosks"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← All kiosks
          </Link>
          <h1 className="mt-1 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            {device.label}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span>{device.locationName ?? "—"}</span>
            <span>·</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${status.classes}`}
            >
              {status.label}
            </span>
          </div>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Last seen"
          value={fmtAgo(device.lastSeenAt)}
        />
        <Stat
          label="Paired"
          value={device.pairedAt ? fmtAgo(device.pairedAt) : "—"}
        />
        <Stat
          label="Selfie on punches"
          value={device.requireSelfie ? "Required" : "Off"}
          valueClass={device.requireSelfie ? "text-[var(--live)]" : "text-[var(--warn)]"}
        />
        <Stat
          label="Visitor sign-in"
          value={device.allowVisitors ? "Enabled" : "Off"}
          valueClass={device.allowVisitors ? "text-[var(--live)]" : "text-[var(--warn)]"}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Device controls</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <form action={toggleSelfieRequiredAction}>
            <input type="hidden" name="deviceId" value={device.id} />
            <input
              type="hidden"
              name="next"
              value={device.requireSelfie ? "off" : "on"}
            />
            <Button type="submit" variant="outline" size="sm">
              {device.requireSelfie
                ? "Disable selfie capture"
                : "Enable selfie capture"}
            </Button>
          </form>
          <form action={toggleVisitorsAllowedAction}>
            <input type="hidden" name="deviceId" value={device.id} />
            <input
              type="hidden"
              name="next"
              value={device.allowVisitors ? "off" : "on"}
            />
            <Button type="submit" variant="outline" size="sm">
              {device.allowVisitors
                ? "Disable visitor sign-in"
                : "Enable visitor sign-in"}
            </Button>
          </form>
          {device.revokedAt ? (
            <form action={restoreKioskAction}>
              <input type="hidden" name="deviceId" value={device.id} />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="border-[color-mix(in_srgb,var(--live)_40%,transparent)] text-[var(--live)] hover:bg-[color-mix(in_srgb,var(--live)_10%,transparent)]"
              >
                Restore
              </Button>
            </form>
          ) : null}
          {(codeExpired || device.revokedAt) ? (
            <form action={regeneratePairingCodeAction}>
              <input type="hidden" name="deviceId" value={device.id} />
              <Button type="submit" variant="outline" size="sm">
                New pairing code
              </Button>
            </form>
          ) : null}
          {!device.revokedAt ? (
            <form action={revokeKioskAction}>
              <input type="hidden" name="deviceId" value={device.id} />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="text-[color:var(--destructive)] border-[color:var(--destructive)]/40 hover:bg-[color:var(--destructive)]/10"
              >
                Revoke
              </Button>
            </form>
          ) : (
            <DeleteKioskButton
              deviceId={device.id}
              label={device.label}
              variant="detail"
            />
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Recent punches</h2>
          <span className="text-xs text-muted-foreground">
            Last {recentPunches.length} kiosk events at this location
          </span>
        </div>
        {recentPunches.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No kiosk punches yet at this location.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recentPunches.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 px-5 py-3"
              >
                {p.hasImage ? (
                  <SelfieThumb
                    eventId={p.id}
                    thumbClassName="h-[42px] w-14 rounded-md border border-border object-cover"
                  />
                ) : (
                  <div
                    className={`flex h-[42px] w-14 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-medium ${
                      p.selfieStatus === "denied"
                        ? "text-[var(--warn)]"
                        : "text-muted-foreground"
                    }`}
                    title={
                      p.selfieStatus === "denied"
                        ? "Camera blocked — punched anyway"
                        : p.selfieStatus === "unavailable"
                          ? "Selfie disabled on this kiosk"
                          : "No selfie"
                    }
                  >
                    {p.selfieStatus === "denied" ? "🚫📷" : "—"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {nameById.get(p.appUserId) ?? "Unknown user"}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${eventBadgeClass(p.eventType)}`}
                    >
                      {eventLabel(p.eventType)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {fmtWhen(p.occurredAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-sm font-medium ${valueClass ?? ""}`}>
        {value}
      </div>
    </div>
  );
}
