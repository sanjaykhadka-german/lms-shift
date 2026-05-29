import "server-only";
import { asc } from "drizzle-orm";
import { lmsWhsKinds, type LmsWhsKind, type TenantDb } from "@tracey/db";
import { tenantWhere } from "./tenant-scope";

// Four kinds that ship with every workspace. The per-tenant migration
// (packages/db/migrations/per-tenant/0009_whs_kinds.sql) seeds these for
// already-provisioned tenants. New tenants get them via ensureSystemKinds()
// below — provisionSql() builds an empty whs_kinds table from the public
// template and we top it up on first /app/admin/whs visit. Idempotent.
export const SYSTEM_KINDS: ReadonlyArray<{
  slug: string;
  label: string;
  category: "expiry" | "incident";
}> = [
  { slug: "high_risk_licence", label: "High-risk licence", category: "expiry" },
  { slug: "fire_warden", label: "Fire warden", category: "expiry" },
  { slug: "first_aider", label: "First aider", category: "expiry" },
  { slug: "incident", label: "Incident", category: "incident" },
];

export async function ensureSystemKinds(opts: {
  db: TenantDb;
  traceyTenantId: string;
}): Promise<void> {
  await opts.db.run(async (tx) => {
    for (const k of SYSTEM_KINDS) {
      await tx
        .insert(lmsWhsKinds)
        .values({
          slug: k.slug,
          label: k.label,
          category: k.category,
          isSystem: true,
          traceyTenantId: opts.traceyTenantId,
        })
        .onConflictDoNothing();
    }
  });
}

export async function listWhsKinds(opts: {
  db: TenantDb;
  traceyTenantId: string;
}): Promise<LmsWhsKind[]> {
  return opts.db.run((tx) =>
    tx
      .select()
      .from(lmsWhsKinds)
      .where(tenantWhere(lmsWhsKinds, opts.traceyTenantId))
      .orderBy(asc(lmsWhsKinds.category), asc(lmsWhsKinds.label)),
  );
}

export function slugifyKind(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}
