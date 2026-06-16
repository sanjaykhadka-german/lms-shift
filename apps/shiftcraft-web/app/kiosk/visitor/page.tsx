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
        .select({ fullName: scEmployees.fullName })
        .from(scEmployees)
        .where(eq(scEmployees.traceyTenantId, tenantId))
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
  const employeeNames = employees
    .map((e) => e.fullName)
    .filter((n): n is string => !!n);

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
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-[#766b5e]">
            Visitor sign-in
          </div>
          <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">
            {locationName}
          </h1>
        </div>
        <Link
          href="/kiosk"
          className="rounded-md border border-[rgba(244,238,227,0.18)] px-3 py-1.5 text-xs text-[#a89c8c] hover:bg-[rgba(244,238,227,0.08)]"
        >
          ← Kiosk
        </Link>
      </header>

      {error === "missing" ? (
        <p className="rounded-md border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] px-4 py-2 text-sm text-[color-mix(in_srgb,var(--danger)_60%,white)]">
          Please fill in your name, mobile, who you're visiting, and sign before
          signing in.
        </p>
      ) : null}

      <VisitorForm
        signedInVisitors={signedInVisitors}
        employeeNames={employeeNames}
      />
    </main>
  );
}
