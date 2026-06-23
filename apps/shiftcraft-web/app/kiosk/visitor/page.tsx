import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  forTenant,
  scEmployees,
  scKioskDevices,
  scLocations,
  scVisitorSignins,
} from "@tracey/db";
import {
  KIOSK_DEVICE_COOKIE,
  verifyDeviceCookie,
} from "~/lib/kiosk/cookies";
import { maybeSweepStaleVisitors } from "~/lib/visitors/sweep";
import { VisitorForm, type SignedInVisitor } from "./_form";

export const metadata = { title: "Kiosk · Visitor" };
export const dynamic = "force-dynamic";

export default async function KioskVisitorPage({
  searchParams,
}: {
  searchParams: Promise<{ signed?: string; error?: string }>;
}) {
  const { signed, error } = await searchParams;
  const cookieStore = await cookies();
  const claim = verifyDeviceCookie(cookieStore.get(KIOSK_DEVICE_COOKIE)?.value);
  if (!claim) redirect("/kiosk");

  const tenantId = claim.tenantId;

  // Visitor sign-in is a per-kiosk opt-in. A device without the flag can't
  // reach this route even by typing the URL.
  const [deviceRow] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ allowVisitors: scKioskDevices.allowVisitors })
      .from(scKioskDevices)
      .where(eq(scKioskDevices.id, claim.deviceId))
      .limit(1),
  );
  if (!deviceRow?.allowVisitors) redirect("/kiosk");

  // Best-effort: close any visitor still signed in 12h+ after arrival before we
  // read the "currently signed in" list, so stale rows drop off naturally.
  await maybeSweepStaleVisitors(tenantId);

  const [locationRows, signedIn, employees] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select({ name: scLocations.name })
        .from(scLocations)
        .where(eq(scLocations.id, claim.locationId))
        .limit(1),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scVisitorSignins.id,
          visitorName: scVisitorSignins.visitorName,
          visitorCompany: scVisitorSignins.visitorCompany,
          visitingPerson: scVisitorSignins.visitingPerson,
          signedInAt: scVisitorSignins.signedInAt,
        })
        .from(scVisitorSignins)
        .where(
          and(
            eq(scVisitorSignins.traceyTenantId, tenantId),
            isNull(scVisitorSignins.signedOutAt),
          ),
        )
        .orderBy(desc(scVisitorSignins.signedInAt)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scEmployees.id, fullName: scEmployees.fullName })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            eq(scEmployees.isActive, true),
          ),
        )
        .orderBy(asc(scEmployees.fullName)),
    ),
  ]);

  const locationName = locationRows[0]?.name ?? "—";
  const signedInVisitors: SignedInVisitor[] = signedIn.map((v) => ({
    id: v.id,
    visitorName: v.visitorName,
    visitorCompany: v.visitorCompany,
    visitingPerson: v.visitingPerson,
    signedInAt: v.signedInAt.toISOString(),
  }));
  const employeeOptions = employees
    .filter((e) => !!e.fullName)
    .map((e) => ({ id: e.id, name: e.fullName }));

  if (signed === "in" || signed === "out") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-12">
        <meta httpEquiv="refresh" content="4;url=/kiosk" />
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--live)_40%,transparent)] bg-[color-mix(in_srgb,var(--live)_15%,transparent)] px-10 py-8 text-center">
          <div className="font-display text-3xl font-semibold text-[color-mix(in_srgb,var(--live)_55%,white)]">
            {signed === "in"
              ? "✓ Signed in — welcome"
              : "✓ Signed out — thank you"}
          </div>
          <div className="mt-2 text-xs text-[color-mix(in_srgb,var(--live)_50%,white)]">
            Returning to the kiosk in a moment…
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-start justify-center px-6 py-10">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-[#1a1512] shadow-xl">
        {/* Lime header band — matches the kiosk landing/roster panels. */}
        <header className="flex items-center justify-between gap-4 bg-[var(--accent)] px-8 py-6 text-[var(--accent-ink)]">
          <div className="min-w-0">
            <div className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--accent-ink)]/70">
              Visitor sign-in
            </div>
            <h1 className="mt-1 truncate font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {locationName}
            </h1>
          </div>
          <Link
            href="/kiosk"
            className="shrink-0 rounded-full bg-[#17130f] px-4 py-2 text-sm font-medium text-[#f4eee3] transition hover:bg-[#241e19]"
          >
            ← Kiosk
          </Link>
        </header>

        <div className="space-y-6 p-8">
          {error ? (
            <p className="rounded-md border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] px-4 py-2 text-sm text-[color-mix(in_srgb,var(--danger)_60%,white)]">
              {error === "notfound"
                ? "No signed-in visitor with that name. Check the spelling or pick from the suggestions."
                : error === "employee"
                  ? "Please choose who you're visiting from the list."
                  : error === "signature"
                    ? "Please add your signature."
                    : error === "company"
                      ? "Please enter the company or organisation you're from."
                      : error === "reason"
                        ? "Please enter a reason for your visit."
                        : "Please fill in your full name and mobile number."}
            </p>
          ) : null}

          <VisitorForm
            signedInVisitors={signedInVisitors}
            employees={employeeOptions}
          />
        </div>
      </div>
    </main>
  );
}
