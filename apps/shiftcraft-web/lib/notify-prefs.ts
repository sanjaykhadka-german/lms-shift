import "server-only";
import { eq } from "drizzle-orm";
import { forTenant, scTenantConfig } from "@tracey/db";

// How shift notifications reach staff. Tenant-wide default lives on
// sc_tenant_config.notify_channel; falls back to "both" when unset.
export type NotifyChannel = "email" | "in_app" | "both";

export async function getNotifyChannel(tenantId: string): Promise<NotifyChannel> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ channel: scTenantConfig.notifyChannel })
      .from(scTenantConfig)
      .where(eq(scTenantConfig.traceyTenantId, tenantId))
      .limit(1),
  );
  const ch = row?.channel;
  return ch === "email" || ch === "in_app" || ch === "both" ? ch : "both";
}

export function wantsEmail(ch: NotifyChannel): boolean {
  return ch === "email" || ch === "both";
}

export function wantsInApp(ch: NotifyChannel): boolean {
  return ch === "in_app" || ch === "both";
}
