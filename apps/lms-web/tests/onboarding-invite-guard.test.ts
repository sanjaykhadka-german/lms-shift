// Regression test for the /onboarding pending-invite guard.
//
// Before this guard, a verified user with a pending invitation could ignore
// the invite link, land on /onboarding, and create a stray tenant. See
// project_invite_onboarding_gap.md for the incident (qc/Thuy, 2026-05-19).
//
// This test pins findPendingInvitationForEmail — the helper both the page
// and the server action call. If the helper regresses, the guard silently
// stops working.
//
// Hits the LIVE local-dev DB. Skipped if DATABASE_URL points at a fake.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, invitations, members, tenants, users } from "@tracey/db";
import { findPendingInvitationForEmail } from "../lib/auth/invitations";

const isLiveDb =
  !!process.env.DATABASE_URL && !/test:test@/.test(process.env.DATABASE_URL);

const INVITEE_EMAIL = "invite-guard-invitee@example.test";
const OWNER_EMAIL = "invite-guard-owner@example.test";
const TENANT_SLUG = "invite-guard-tenant";
const TOKEN_VALID = "invite-guard-token-valid";
const TOKEN_EXPIRED = "invite-guard-token-expired";

describe.skipIf(!isLiveDb)("findPendingInvitationForEmail", () => {
  let ownerId: string;
  let tenantId: string;

  beforeAll(async () => {
    // Cleanup any stale rows from prior runs (idempotent).
    await db.delete(invitations).where(eq(invitations.email, INVITEE_EMAIL));
    await db.delete(tenants).where(eq(tenants.slug, TENANT_SLUG));
    await db.delete(users).where(eq(users.email, OWNER_EMAIL));

    const [owner] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        email: OWNER_EMAIL,
        name: "Invite Guard Owner",
      })
      .returning({ id: users.id });
    if (!owner) throw new Error("seed: owner insert returned no row");
    ownerId = owner.id;

    const [tenant] = await db
      .insert(tenants)
      .values({
        ownerUserId: ownerId,
        slug: TENANT_SLUG,
        name: "Invite Guard Tenant",
        plan: "free",
        status: "trialing",
      })
      .returning({ id: tenants.id });
    if (!tenant) throw new Error("seed: tenant insert returned no row");
    tenantId = tenant.id;

    await db.insert(members).values({
      tenantId,
      userId: ownerId,
      role: "owner",
    });
  });

  afterAll(async () => {
    await db.delete(invitations).where(eq(invitations.email, INVITEE_EMAIL));
    if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(users).where(eq(users.email, OWNER_EMAIL));
  });

  it("returns the invite for a case-mismatched email when expiresAt is in the future", async () => {
    await db.delete(invitations).where(eq(invitations.email, INVITEE_EMAIL));
    await db.insert(invitations).values({
      tenantId,
      email: INVITEE_EMAIL,
      role: "member",
      token: TOKEN_VALID,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      invitedByUserId: ownerId,
    });

    // Same email, different case — should still match.
    const hit = await findPendingInvitationForEmail("Invite-Guard-Invitee@Example.Test");
    expect(hit).not.toBeNull();
    expect(hit?.token).toBe(TOKEN_VALID);
    expect(hit?.tenantId).toBe(tenantId);
    expect(hit?.tenantName).toBe("Invite Guard Tenant");
    expect(hit?.role).toBe("member");
  });

  it("returns null when the only invitation has expired", async () => {
    await db.delete(invitations).where(eq(invitations.email, INVITEE_EMAIL));
    await db.insert(invitations).values({
      tenantId,
      email: INVITEE_EMAIL,
      role: "member",
      token: TOKEN_EXPIRED,
      expiresAt: new Date(Date.now() - 1000 * 60),
      invitedByUserId: ownerId,
    });

    const miss = await findPendingInvitationForEmail(INVITEE_EMAIL);
    expect(miss).toBeNull();
  });

  it("returns null when no invitation exists for the email", async () => {
    await db.delete(invitations).where(eq(invitations.email, INVITEE_EMAIL));
    const miss = await findPendingInvitationForEmail(INVITEE_EMAIL);
    expect(miss).toBeNull();
  });
});
