import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import {
  forTenant,
  scWebhookDeliveries,
  scWebhookSubscriptions,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { WEBHOOK_EVENTS } from "~/lib/webhooks";
import { CreateSubscriptionForm } from "./_create-form";
import {
  deleteSubscriptionAction,
  retryDeliveryAction,
  rotateSecretAction,
  togglePauseAction,
} from "./actions";

export const metadata = { title: "Webhooks · ShiftCraft" };
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  succeeded: "bg-emerald-600 text-white",
  failed: "bg-rose-600 text-white",
  pending: "bg-amber-500 text-white",
};

function fmtRelative(d: Date | null): string {
  if (!d) return "—";
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString();
}

export default async function WebhooksAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ reveal?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");

  const { reveal: revealId } = await searchParams;
  const tenantId = membership.tenant.id;

  const [subscriptions, deliveries] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select()
        .from(scWebhookSubscriptions)
        .where(eq(scWebhookSubscriptions.traceyTenantId, tenantId))
        .orderBy(desc(scWebhookSubscriptions.createdAt)),
    ),
    // Last 50 deliveries across all subscriptions. Enough to spot a
    // recent failure run; the cron-style pagination can come later.
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scWebhookDeliveries.id,
          subscriptionId: scWebhookDeliveries.subscriptionId,
          event: scWebhookDeliveries.event,
          status: scWebhookDeliveries.status,
          attemptCount: scWebhookDeliveries.attemptCount,
          responseStatus: scWebhookDeliveries.responseStatus,
          lastError: scWebhookDeliveries.lastError,
          createdAt: scWebhookDeliveries.createdAt,
          updatedAt: scWebhookDeliveries.updatedAt,
          subUrl: scWebhookSubscriptions.url,
          subLabel: scWebhookSubscriptions.label,
        })
        .from(scWebhookDeliveries)
        .leftJoin(
          scWebhookSubscriptions,
          and(
            eq(
              scWebhookSubscriptions.id,
              scWebhookDeliveries.subscriptionId,
            ),
            eq(scWebhookSubscriptions.traceyTenantId, tenantId),
          ),
        )
        .where(eq(scWebhookDeliveries.traceyTenantId, tenantId))
        .orderBy(desc(scWebhookDeliveries.createdAt))
        .limit(50),
    ),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Forward ShiftCraft events to your own integrations. Each
          delivery carries an{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            X-Webhook-Signature: sha256=…
          </code>{" "}
          header — HMAC-SHA256 of the raw body with the per-subscription
          secret. Verify it on receipt to reject spoofed payloads.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Add a subscription</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          We generate a secret on save and reveal it once below. Copy it
          immediately — you can rotate later but the existing secret is
          never re-shown.
        </p>
        <CreateSubscriptionForm events={WEBHOOK_EVENTS} />
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">
            Subscriptions ({subscriptions.length})
          </h2>
        </div>
        {subscriptions.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No subscriptions yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {subscriptions.map((s) => {
              const revealed = revealId === s.id;
              return (
                <li key={s.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
                      {s.event}
                    </span>
                    {!s.isActive && (
                      <span className="inline-flex items-center rounded-full bg-slate-500 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
                        Paused
                      </span>
                    )}
                    {s.label && (
                      <span className="text-sm font-medium">{s.label}</span>
                    )}
                  </div>
                  <div className="break-all font-mono text-xs text-muted-foreground">
                    {s.url}
                  </div>
                  <div className="flex flex-wrap gap-4 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>
                      Last success:{" "}
                      <span className="font-mono text-foreground">
                        {fmtRelative(s.lastSuccessAt)}
                      </span>
                    </span>
                    <span>
                      Last failure:{" "}
                      <span className="font-mono text-foreground">
                        {fmtRelative(s.lastFailureAt)}
                      </span>
                    </span>
                  </div>
                  {revealed && (
                    <div className="rounded-md border-2 border-amber-500/60 bg-amber-50 px-3 py-2 text-xs dark:border-amber-500/40 dark:bg-amber-950/30">
                      <div className="font-medium text-amber-900 dark:text-amber-200">
                        Secret (revealed once — copy now)
                      </div>
                      <code className="mt-1 block break-all font-mono text-xs">
                        {s.secret}
                      </code>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={togglePauseAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="pause" value={s.isActive ? "1" : "0"} />
                      <Button type="submit" size="sm" variant="outline">
                        {s.isActive ? "Pause" : "Resume"}
                      </Button>
                    </form>
                    <form action={rotateSecretAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <Button type="submit" size="sm" variant="outline">
                        Rotate secret
                      </Button>
                    </form>
                    <form action={deleteSubscriptionAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </Button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">
            Recent deliveries ({deliveries.length})
          </h2>
        </div>
        {deliveries.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No deliveries yet — events will appear here once a matching
            action fires.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Attempts</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                      {fmtRelative(d.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{d.event}</td>
                    <td className="max-w-[240px] truncate px-3 py-2 text-xs">
                      {d.subLabel ?? d.subUrl ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE[d.status] ?? "bg-zinc-500 text-white"}`}
                      >
                        {d.status}
                        {d.responseStatus != null && d.status !== "pending" && (
                          <span className="ml-1 font-mono">
                            {d.responseStatus}
                          </span>
                        )}
                      </span>
                      {d.lastError && (
                        <div className="mt-1 max-w-[260px] truncate font-mono text-[10px] text-muted-foreground">
                          {d.lastError}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {d.attemptCount}
                    </td>
                    <td className="px-3 py-2">
                      {d.status === "failed" && (
                        <form action={retryDeliveryAction}>
                          <input type="hidden" name="id" value={d.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Retry
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
