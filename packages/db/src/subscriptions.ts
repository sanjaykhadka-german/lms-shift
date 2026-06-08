// Per-app subscription data access.
//
// One row per (tenant, app) in app.tenant_subscriptions. These helpers are
// the single read/write surface for billing state going forward; app code
// should not read the legacy billing columns on `tenants` directly.

import { and, eq } from "drizzle-orm";
import type { App } from "@tracey/types";
import { db } from "./client";
import { tenantSubscriptions } from "./schema";

export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;
export type NewTenantSubscription = typeof tenantSubscriptions.$inferInsert;

/** The subscription row for one app of one tenant, or undefined if none. */
export async function getSubscription(
  tenantId: string,
  app: App,
): Promise<TenantSubscription | undefined> {
  const [row] = await db
    .select()
    .from(tenantSubscriptions)
    .where(
      and(
        eq(tenantSubscriptions.tenantId, tenantId),
        eq(tenantSubscriptions.app, app),
      ),
    )
    .limit(1);
  return row;
}

/** All app subscriptions for a tenant (lms, shiftcraft, …). */
export async function listTenantSubscriptions(
  tenantId: string,
): Promise<TenantSubscription[]> {
  return db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, tenantId));
}
