import "server-only";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { forTenant, scVisitorSignins } from "@tracey/db";
import { logAuditEvent } from "~/lib/audit";

// Auto sign-out for forgotten visitor records. Visitors who don't sign out at
// the kiosk leave an open row (signed_out_at = NULL) that shows as "On site"
// forever, polluting the reception/fire register. Unlike employees, visitors
// have no scheduled shift to derive an end time from, so we close them at a
// fixed offset: anyone still signed in 12h+ after arrival is stamped out at
// signed_in_at + 12h (a bounded, plausible end — mirrors the employee sweep's
// "scheduled end" rather than the much-later sweep time).
//
// Two entry points share sweepStaleVisitors: the manager "Sign out" button on
// /app/admin/visitors handles the deliberate one-offs, while maybeSweepStaleVisitors
// is the throttled best-effort sweep fired on page loads. No cron.
const VISITOR_STALE_MS = 12 * 60 * 60 * 1000;
// Sweep at most once per hour per tenant per server instance. In-memory (no
// migration); resets on deploy/restart, which is harmless because the sweep is
// idempotent (the WHERE re-checks signed_out_at IS NULL).
const SWEEP_THROTTLE_MS = 60 * 60 * 1000;
const lastSweepByTenant = new Map<string, number>();

const AUTO_NOTE = "Auto sign-out: still signed in 12h+ after arrival.";

// Core sweep — tenant-scoped, NO auth gate and NO revalidate. Shared by the
// throttled auto-trigger; callers add what they need.
async function sweepStaleVisitors(
  tenantId: string,
): Promise<{ closed: number }> {
  const cutoff = new Date(Date.now() - VISITOR_STALE_MS);

  // Open rows whose arrival is now older than the stale window.
  const stale = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scVisitorSignins.id,
        signedInAt: scVisitorSignins.signedInAt,
        notes: scVisitorSignins.notes,
      })
      .from(scVisitorSignins)
      .where(
        and(
          eq(scVisitorSignins.traceyTenantId, tenantId),
          isNull(scVisitorSignins.signedOutAt),
          lte(scVisitorSignins.signedInAt, cutoff),
        ),
      )
      .orderBy(asc(scVisitorSignins.signedInAt)),
  );

  let closed = 0;
  for (const v of stale) {
    const outAt = new Date(v.signedInAt.getTime() + VISITOR_STALE_MS);
    const notes = v.notes ? `${v.notes} · ${AUTO_NOTE}` : AUTO_NOTE;

    // Re-guard on signed_out_at IS NULL so a concurrent kiosk/manager sign-out
    // wins and we never reopen a closed visit.
    const updated = await forTenant(tenantId).run((tx) =>
      tx
        .update(scVisitorSignins)
        .set({ signedOutAt: outAt, notes })
        .where(
          and(
            eq(scVisitorSignins.id, v.id),
            eq(scVisitorSignins.traceyTenantId, tenantId),
            isNull(scVisitorSignins.signedOutAt),
          ),
        )
        .returning({ id: scVisitorSignins.id }),
    );
    if (updated.length === 0) continue; // lost the race — leave it

    await logAuditEvent({
      action: "shiftcraft.visitor.auto_closed",
      targetKind: "sc_visitor_signins",
      targetId: v.id,
      details: {
        signedInAt: v.signedInAt.toISOString(),
        autoSignedOutAt: outAt.toISOString(),
      },
    });
    closed++;
  }

  return { closed };
}

// Automatic trigger — call from frequently-loaded server components (the kiosk
// visitor page, the admin visitors page) BEFORE their own queries, so any
// auto-closes are read back naturally without a revalidate. Throttled to once
// per hour per tenant and fully best-effort: it never throws into the caller's
// render, and a transient failure just means the next eligible load tries again.
export async function maybeSweepStaleVisitors(tenantId: string): Promise<void> {
  const now = Date.now();
  const last = lastSweepByTenant.get(tenantId) ?? 0;
  if (now - last < SWEEP_THROTTLE_MS) return;
  // Claim the slot before awaiting so concurrent requests don't double-run.
  lastSweepByTenant.set(tenantId, now);
  try {
    await sweepStaleVisitors(tenantId);
  } catch (err) {
    console.warn("[maybeSweepStaleVisitors] sweep failed:", err);
  }
}
