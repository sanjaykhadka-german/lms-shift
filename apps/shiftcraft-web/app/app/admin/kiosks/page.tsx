import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { InfoPopover } from "~/components/InfoPopover";
import {
  forTenant,
  scKioskDevices,
  scLocations,
  type ScKioskDevice,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { PairKioskForm } from "./_pair_form";
import { DeleteKioskButton } from "./_delete_button";
import {
  regeneratePairingCodeAction,
  restoreKioskAction,
  revokeKioskAction,
} from "./actions";

export const metadata = { title: "Kiosks · ShiftCraft" };

type KioskRow = ScKioskDevice & { locationName: string | null };

function statusBadge(d: KioskRow): {
  label: string;
  classes: string;
} {
  if (d.revokedAt) {
    return { label: "Revoked", classes: "bg-[var(--ink-3)] text-white" };
  }
  if (d.pairedAt) {
    return { label: "Active", classes: "bg-[var(--live)] text-white" };
  }
  if (d.pairingExpiresAt && d.pairingExpiresAt.getTime() < Date.now()) {
    return { label: "Code expired", classes: "bg-[var(--warn)] text-white" };
  }
  return { label: "Awaiting pair", classes: "bg-[var(--accent-deep)] text-[var(--accent-ink)]" };
}

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

// Derive the public origin (scheme + host) from the request headers so
// the QR code links to a URL the kiosk device can actually resolve.
// Render proxies set x-forwarded-* so we trust those first; locally
// `host` is the only one set.
async function publicOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:4100";
  return `${proto}://${host}`;
}

export default async function KiosksAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ paired?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  const { paired } = await searchParams;

  const [devices, locations] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scKioskDevices.id,
          traceyTenantId: scKioskDevices.traceyTenantId,
          label: scKioskDevices.label,
          locationId: scKioskDevices.locationId,
          pairingCode: scKioskDevices.pairingCode,
          pairingExpiresAt: scKioskDevices.pairingExpiresAt,
          pairedAt: scKioskDevices.pairedAt,
          lastSeenAt: scKioskDevices.lastSeenAt,
          revokedAt: scKioskDevices.revokedAt,
          requireSelfie: scKioskDevices.requireSelfie,
          createdByUserId: scKioskDevices.createdByUserId,
          createdAt: scKioskDevices.createdAt,
          locationName: scLocations.name,
        })
        .from(scKioskDevices)
        .leftJoin(
          scLocations,
          eq(scLocations.id, scKioskDevices.locationId),
        )
        .where(eq(scKioskDevices.traceyTenantId, tenantId))
        .orderBy(desc(scKioskDevices.createdAt)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name })
        .from(scLocations)
        .where(eq(scLocations.traceyTenantId, tenantId))
        .orderBy(asc(scLocations.name)),
    ),
  ]);

  // If we just paired a kiosk (or regenerated a code), pull that row out
  // for the prominent code/QR card. The row is found via the ?paired=<id>
  // query string. Skipped silently if the id doesn't match anything.
  const pairedDevice = paired
    ? (devices.find((d) => d.id === paired) ?? null)
    : null;
  const showPairedCard =
    pairedDevice &&
    !pairedDevice.revokedAt &&
    !pairedDevice.pairedAt &&
    pairedDevice.pairingCode;

  let pairUrl: string | null = null;
  let qrDataUrl: string | null = null;
  if (showPairedCard) {
    const origin = await publicOrigin();
    // Tenant id is in the URL because pairing codes are unique only within
    // a tenant (partial index). Without it the /kiosk/pair handler would
    // need to fan out across every tenant schema to find the row.
    pairUrl = `${origin}/kiosk/pair?code=${pairedDevice.pairingCode}&t=${tenantId}`;
    qrDataUrl = await QRCode.toDataURL(pairUrl, {
      // Quiet zone must be ≥4 modules or many camera scanners won't lock on;
      // margin:1 was the reason the code "wouldn't scan". Larger render + a
      // bit more error correction also helps phone cameras at arm's length.
      margin: 4,
      width: 320,
      errorCorrectionLevel: "Q",
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Kiosks
          <InfoPopover label="About kiosks">
            <p>
              On-premise tablet/laptop devices for shared clock-in.
              Generate a short-lived pairing code, hand it to the
              device, and it exchanges for a long-lived cookie scoped
              to one location.
            </p>
            <p className="mt-1">
              Workers authenticate at the kiosk with a 4-digit PIN
              (set per-employee). Optional selfie on each punch — a
              webcam-less device can disable it via{" "}
              <strong>Require selfie</strong>.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register an on-premise device (tablet / laptop) where employees can
          clock in with a 4-digit PIN. Each kiosk is pinned to one location;
          punches recorded on it are tagged automatically.
        </p>
      </div>

      {showPairedCard && pairUrl && qrDataUrl ? (
        <section className="rounded-lg border-2 border-primary/40 bg-primary/5 p-6 shadow-sm">
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            <div className="flex-1 space-y-3">
              <h2 className="text-base font-semibold text-ink">
                Pair {pairedDevice.label}
              </h2>
              <p className="text-sm text-muted-foreground">
                On the kiosk device, open this URL or scan the QR. The code
                works once and expires{" "}
                {pairedDevice.pairingExpiresAt
                  ? `at ${pairedDevice.pairingExpiresAt.toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "in 15 minutes"}
                .
              </p>
              <div className="rounded-md border border-border bg-background p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Pairing code
                </div>
                <div className="font-mono text-3xl font-bold tracking-[0.25em] text-foreground">
                  {pairedDevice.pairingCode}
                </div>
              </div>
              <div className="rounded-md border border-border bg-background p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Pair URL
                </div>
                <div className="mt-1 break-all font-mono text-xs text-foreground">
                  {pairUrl}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/app/admin/kiosks">Done</Link>
                </Button>
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              {/* QR is a data URL, so plain <img> is correct here (next/image
                  would proxy through the optimiser for no benefit). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt={`QR code to pair ${pairedDevice.label}`}
                width={320}
                height={320}
                className="rounded-md border border-border bg-white p-3"
              />
              <span className="text-[11px] text-muted-foreground">
                Scan on the kiosk
              </span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Add a kiosk</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          You'll get a single-use code and QR to enter on the device — valid
          for 15 minutes.
        </p>
        <div className="mt-4">
          <PairKioskForm
            locations={locations}
            defaultLocationId={locations[0]?.id ?? null}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Registered kiosks</h2>
        </div>
        {devices.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No kiosks yet. Pair one above.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {devices.map((d) => {
              const badge = statusBadge(d);
              const codeExpired =
                !d.pairedAt &&
                !d.revokedAt &&
                d.pairingExpiresAt &&
                d.pairingExpiresAt.getTime() < Date.now();
              return (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/app/admin/kiosks/${d.id}`}
                        className="font-medium hover:underline"
                      >
                        {d.label}
                      </Link>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                      {!d.requireSelfie ? (
                        <span className="inline-flex items-center rounded-full bg-[var(--ink-3)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                          Selfie off
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {d.locationName ?? "—"} · last seen{" "}
                      {fmtAgo(d.lastSeenAt)}
                      {d.pairedAt
                        ? ` · paired ${fmtAgo(d.pairedAt)}`
                        : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/app/admin/kiosks/${d.id}`}>Manage</Link>
                    </Button>
                    {d.revokedAt ? (
                      <form action={restoreKioskAction}>
                        <input
                          type="hidden"
                          name="deviceId"
                          value={d.id}
                        />
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
                    {(codeExpired || d.revokedAt) ? (
                      <form action={regeneratePairingCodeAction}>
                        <input
                          type="hidden"
                          name="deviceId"
                          value={d.id}
                        />
                        <Button type="submit" variant="outline" size="sm">
                          New pairing code
                        </Button>
                      </form>
                    ) : null}
                    {!d.revokedAt ? (
                      <form action={revokeKioskAction}>
                        <input
                          type="hidden"
                          name="deviceId"
                          value={d.id}
                        />
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
                        deviceId={d.id}
                        label={d.label}
                        variant="row"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
