"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db, forTenant, members, scDocuments, users } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { notifyTenantAdmins } from "~/lib/notifications";
import {
  classifyDocuments,
  EXPIRY_WARN_DAYS,
  summariseExpiry,
} from "~/lib/document-expiry";
import { sendDocumentExpiryDigest } from "~/lib/email";

// Manual digest trigger — Render dropped free crons so the operator
// fires this from /app/admin/documents-expiring on a cadence that
// suits them (typically weekly). Fans out an in-app notification +
// best-effort email to every owner/admin.

export async function sendExpiryDigestAction(): Promise<void> {
  const membership = await currentMembership();
  if (!membership) return;
  if (!isAtLeastManager(membership.role)) return;
  const tenantId = membership.tenant.id;

  const horizon = new Date();
  horizon.setDate(horizon.getDate() + EXPIRY_WARN_DAYS + 1);

  // Pull every doc with an expiry that's already passed or within the
  // warning window. Library-scope docs are included alongside team docs
  // so a HACCP plan in the public library can still drive an alert.
  const docs = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scDocuments.id,
        title: scDocuments.title,
        scope: scDocuments.scope,
        employeeId: scDocuments.employeeId,
        expiresAt: scDocuments.expiresAt,
      })
      .from(scDocuments)
      .where(
        and(
          eq(scDocuments.traceyTenantId, tenantId),
          isNotNull(scDocuments.expiresAt),
          lte(scDocuments.expiresAt, horizon),
        ),
      ),
  );

  const classified = classifyDocuments(
    docs.map((d) => ({
      id: d.id,
      title: d.title,
      scope: d.scope as "team" | "library",
      employeeId: d.employeeId,
      expiresAt: d.expiresAt,
    })),
  );

  await logAuditEvent({
    action: "shiftcraft.documents.expiry_digest_sent",
    targetKind: null,
    targetId: null,
    details: {
      total: classified.total,
      expired: classified.byTier.expired.length,
      lte7: classified.byTier.lte7.length,
      lte14: classified.byTier.lte14.length,
      lte30: classified.byTier.lte30.length,
    },
  });

  if (classified.total === 0) {
    // Still log + revalidate so the admin sees the "no expiring docs"
    // confirmation; skip the fan-out (no noise on empty digests).
    revalidatePath("/app/admin/documents-expiring");
    return;
  }

  const summaryParts: string[] = [];
  if (classified.byTier.expired.length > 0)
    summaryParts.push(`${classified.byTier.expired.length} expired`);
  if (classified.byTier.lte7.length > 0)
    summaryParts.push(`${classified.byTier.lte7.length} in ≤7d`);
  if (classified.byTier.lte14.length > 0)
    summaryParts.push(`${classified.byTier.lte14.length} in 8–14d`);
  if (classified.byTier.lte30.length > 0)
    summaryParts.push(`${classified.byTier.lte30.length} in 15–30d`);

  await notifyTenantAdmins(tenantId, {
    kind: "shiftcraft.documents.expiring",
    title: `${classified.total} document${classified.total === 1 ? "" : "s"} expiring`,
    body: summaryParts.join(" · "),
    actionUrl: "/app/admin/documents-expiring",
  });

  // Email digest — best-effort. Pull admin emails inline so the email
  // helper itself can stay DB-free. owner+admin only matches the
  // notifyTenantAdmins fan-out so the email and bell entry land on the
  // same audience.
  const adminRecipients = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .innerJoin(members, eq(members.userId, users.id))
    .where(
      and(
        eq(members.tenantId, tenantId),
        inArray(members.role, ["owner", "admin"]),
      ),
    );
  const adminEmails = adminRecipients
    .filter((m) => m.email && m.email.length > 0)
    .map((m) => ({ email: m.email!, name: m.name }));

  const summary = summariseExpiry(classified);
  if (summary && adminEmails.length > 0) {
    await sendDocumentExpiryDigest({
      to: adminEmails,
      tenantName: membership.tenant.name,
      total: classified.total,
      summary,
    });
  }

  revalidatePath("/app/admin/documents-expiring");
  revalidatePath("/app/people/team-documents");
}
