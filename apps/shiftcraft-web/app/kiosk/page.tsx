import { cookies } from "next/headers";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  forTenant,
  scEmployeePins,
  scKioskDevices,
  scLocations,
  tenants,
  users,
  db,
} from "@tracey/db";
import {
  KIOSK_DEVICE_COOKIE,
  verifyDeviceCookie,
} from "~/lib/kiosk/cookies";
import {
  loadWhosHereAtLocation,
  type WhosHerePerson,
} from "~/lib/kiosk/whos-here";
import { KioskSignIn, type KioskPerson } from "./_signin";

export const metadata = { title: "Kiosk" };
// The kiosk surface is always fresh — clock state, who's-here, last-seen
// timestamps. Disable Next's static generation for this route group.
export const dynamic = "force-dynamic";

interface PairedState {
  tenantId: string;
  locationId: string | null;
  tenantName: string;
  locationName: string;
  requireSelfie: boolean;
}

// Resolves the device cookie into the live device + location row. Returns
// null if the cookie is missing, signature-invalid, the device was revoked,
// or the row is gone entirely (admin deleted it). Also bumps last_seen_at
// as a side effect so the admin device list shows "online".
async function resolvePairing(): Promise<PairedState | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(KIOSK_DEVICE_COOKIE)?.value;
  const claim = verifyDeviceCookie(raw);
  if (!claim) return null;

  const rows = await forTenant(claim.tenantId).run((tx) =>
    tx
      .select({
        deviceId: scKioskDevices.id,
        requireSelfie: scKioskDevices.requireSelfie,
        locationName: scLocations.name,
      })
      .from(scKioskDevices)
      .leftJoin(scLocations, eq(scLocations.id, scKioskDevices.locationId))
      .where(
        and(
          eq(scKioskDevices.id, claim.deviceId),
          eq(scKioskDevices.traceyTenantId, claim.tenantId),
          isNull(scKioskDevices.revokedAt),
        ),
      )
      .limit(1),
  );
  const device = rows[0];
  if (!device) return null;

  // Bump last_seen_at so admins can spot offline devices. Fire-and-forget;
  // a failure here mustn't block the kiosk render.
  await forTenant(claim.tenantId)
    .run((tx) =>
      tx
        .update(scKioskDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(scKioskDevices.id, claim.deviceId)),
    )
    .catch((err) => console.error("[kiosk] last_seen bump failed:", err));

  // Tenant name comes from the shared app schema, not the per-tenant
  // schema. One small extra query — cheap.
  const [tenantRow] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, claim.tenantId))
    .limit(1);

  return {
    tenantId: claim.tenantId,
    locationId: claim.locationId,
    tenantName: tenantRow?.name ?? "Workspace",
    locationName: device.locationName ?? "—",
    requireSelfie: device.requireSelfie,
  };
}

// Roster for the name-select sign-in: every employee in the company who has a
// kiosk PIN, resolved to a display name + avatar. Names live in the shared app
// schema (users); the PIN rows live per-tenant.
async function loadRoster(tenantId: string): Promise<KioskPerson[]> {
  const pinRows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ appUserId: scEmployeePins.appUserId })
      .from(scEmployeePins)
      .where(eq(scEmployeePins.traceyTenantId, tenantId)),
  );
  const ids = pinRows.map((r) => r.appUserId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(users)
    .where(inArray(users.id, ids));
  return rows
    .map((u) => ({
      id: u.id,
      name: u.name ?? u.email ?? "—",
      image: u.image,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function errorMessage(reason: string | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case "bad_link":
      return "That pairing link wasn't valid. Ask a manager for a new one.";
    case "code_invalid":
      return "Pairing code was wrong, expired, or already used. Ask a manager to generate a new one.";
    case "transition":
      return null; // handled separately, uses ?detail=
    default:
      return "Pairing didn't work. Ask a manager for a new code.";
  }
}

function punchedLabel(p: string | undefined): string | null {
  switch (p) {
    case "in":
      return "✓ Clocked in";
    case "out":
      return "✓ Clocked out — see you next shift";
    case "break_start":
      return "✓ On break";
    case "break_end":
      return "✓ Back on shift";
    default:
      return null;
  }
}

export default async function KioskHome({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    detail?: string;
    punched?: string;
  }>;
}) {
  const { error, detail, punched } = await searchParams;
  const errMsg =
    error === "transition" && detail
      ? decodeURIComponent(detail)
      : errorMessage(error);
  const punched_msg = punchedLabel(punched);
  const paired = await resolvePairing();
  const [roster, whosHere]: [KioskPerson[], WhosHerePerson[]] = paired
    ? await Promise.all([
        loadRoster(paired.tenantId),
        loadWhosHereAtLocation(paired.tenantId, paired.locationId),
      ])
    : [[], []];

  if (!paired) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-[rgba(244,238,227,0.13)] bg-[rgba(244,238,227,0.05)] p-8 text-center shadow-xl">
          <h1 className="font-display font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Kiosk not paired
          </h1>
          <p className="text-sm text-[#a89c8c]">
            This device isn't registered yet. A manager needs to pair it
            from the admin app:
          </p>
          <ol className="space-y-1 rounded-md bg-[#17130f] px-4 py-3 text-left text-xs text-[#a89c8c]">
            <li>1. Sign in at the main app</li>
            <li>2. Go to Kiosks → Add a kiosk</li>
            <li>3. Open the pairing link on this device</li>
          </ol>
          {errMsg ? (
            <p className="rounded-md border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] px-3 py-2 text-xs text-[color-mix(in_srgb,var(--warn)_60%,white)]">
              {errMsg}
            </p>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 px-6 py-12">
      {punched_msg ? (
        <>
          <header className="space-y-1 text-center">
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-[#766b5e]">
              {paired.tenantName}
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {paired.locationName}
            </h1>
          </header>
          <PunchedSplash message={punched_msg} />
        </>
      ) : (
        <>
          {errMsg ? (
            <p className="rounded-md border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] px-4 py-2 text-sm text-[color-mix(in_srgb,var(--danger)_60%,white)]">
              {errMsg}
            </p>
          ) : null}
          <KioskSignIn
            people={roster}
            tenantName={paired.tenantName}
            locationName={paired.locationName}
            whosHere={whosHere}
            rosterCount={roster.length}
          />
        </>
      )}
    </main>
  );
}

// 3-second confirmation splash after a successful punch. Auto-redirects to
// the bare /kiosk so the next employee sees a clean numpad. The meta
// refresh works even if JS is off (defensive).
function PunchedSplash({ message }: { message: string }) {
  return (
    <>
      <meta httpEquiv="refresh" content="3;url=/kiosk" />
      <div className="rounded-xl border border-[color-mix(in_srgb,var(--live)_40%,transparent)] bg-[color-mix(in_srgb,var(--live)_15%,transparent)] px-10 py-8 text-center">
        <div className="font-display text-3xl font-semibold text-[color-mix(in_srgb,var(--live)_55%,white)]">
          {message}
        </div>
        <div className="mt-2 text-xs text-[color-mix(in_srgb,var(--live)_50%,white)]">
          Returning to the kiosk in a moment…
        </div>
      </div>
    </>
  );
}
