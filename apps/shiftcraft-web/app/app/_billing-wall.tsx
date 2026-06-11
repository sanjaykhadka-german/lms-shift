import type { AccessLevel } from "~/lib/billing/access";
import { SubscribePlans } from "./_subscribe-plans";

// Rendered in place of the app content when an entitlement-gated tenant has
// lost ShiftCraft access (trial lapsed / past_due / canceled). Lives inside
// the normal /app chrome (sidebar + topbar) so the user keeps their bearings.
export function BillingWall({ level }: { level: AccessLevel }) {
  const headline =
    level === "read_only"
      ? "Your ShiftCraft trial has ended"
      : "ShiftCraft access is paused";
  const sub =
    level === "read_only"
      ? "You can still view your data, but adding shifts, clocking in, and edits are locked. Subscribe to continue."
      : "Your subscription is no longer active. Subscribe to restore full access for your team.";

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="rounded-[var(--r-lg)] border border-line bg-[var(--paper)] p-8 shadow-[var(--shadow-sm)]">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
          Subscription
        </div>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-[-0.01em] text-ink">
          {headline}
        </h1>
        <p className="mt-2 text-sm text-ink-2">{sub}</p>
        <div className="mt-6">
          <SubscribePlans />
        </div>
      </div>
    </div>
  );
}
