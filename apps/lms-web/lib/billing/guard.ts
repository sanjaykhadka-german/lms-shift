import "server-only";
import { NextResponse } from "next/server";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isPlatformAdmin } from "~/lib/auth/platform";
import { accessLevelFor, type AccessLevel } from "./access";
import type { Tenant } from "@tracey/db";

export interface TenantAccess {
  tenant: Tenant;
  level: AccessLevel;
  /** Platform admins bypass billing gates so support can debug a frozen tenant. */
  bypassed: boolean;
}

/**
 * Compute the effective access level for the current request: combines
 * `accessLevelFor()` with a platform-admin override.
 */
export async function getTenantAccess(): Promise<TenantAccess | null> {
  const m = await currentMembership();
  if (!m) return null;
  const user = await currentUser();
  const bypassed = !!user && isPlatformAdmin(user.email);
  const level: AccessLevel = bypassed ? "full" : accessLevelFor(m.tenant);
  return { tenant: m.tenant, level, bypassed };
}

/**
 * Guard for mutating API routes. Returns `null` when the request may proceed,
 * or a 403 NextResponse when the tenant is read-only or blocked. Always
 * resolves the tenant via `currentMembership()` so callers don't need to.
 *
 * Usage:
 *   const denied = await requireWriteAccess();
 *   if (denied) return denied;
 */
export async function requireWriteAccess(): Promise<NextResponse | null> {
  const access = await getTenantAccess();
  if (!access) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (access.level === "full") return null;
  return NextResponse.json(
    {
      error: "subscription_required",
      level: access.level,
      status: access.tenant.status,
    },
    { status: 403 },
  );
}

/**
 * Subclass of Error so server actions can branch on it (typically by surfacing
 * a friendly form error rather than a 500). Throwing is the right shape for
 * server actions because they don't have access to NextResponse.
 */
export class BillingGateError extends Error {
  readonly level: AccessLevel;
  readonly tenantStatus: string;
  constructor(level: AccessLevel, tenantStatus: string) {
    super("subscription_required");
    this.name = "BillingGateError";
    this.level = level;
    this.tenantStatus = tenantStatus;
  }
}

/**
 * Server-action variant of `requireWriteAccess()`. Throws `BillingGateError`
 * when the tenant is read-only or blocked, so the action aborts before
 * mutating anything.
 */
export async function assertWriteAccess(): Promise<void> {
  const access = await getTenantAccess();
  if (!access) throw new BillingGateError("blocked", "unknown");
  if (access.level === "full") return;
  throw new BillingGateError(access.level, access.tenant.status);
}
