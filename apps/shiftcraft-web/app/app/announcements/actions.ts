"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  forTenant,
  members,
  scAnnouncements,
  users as appUsers,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { notifyAnnouncementPosted } from "~/lib/email";
import { getUnsubscribedUserIds } from "~/lib/email-prefs";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const announcementSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(4000),
  pinned: z.string().optional(), // checkbox: "on" or undefined
  notifyByEmail: z.string().optional(), // checkbox: "on" or undefined
  expiresAt: z.string().optional().or(z.literal("")),
});

function requireAdmin(role: string): true | string {
  if (isAtLeastManager(role)) return true;
  return "Only admins can manage announcements.";
}

function parseExpiresOrNull(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // <input type="datetime-local"> → "YYYY-MM-DDTHH:mm". Treat as local time.
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createAnnouncementAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const m = await currentMembership();
  if (!m) {
    return { status: "error", message: "No workspace selected." };
  }
  const gate = requireAdmin(m.role);
  if (gate !== true) return { status: "error", message: gate };

  const parsed = announcementSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    pinned: formData.get("pinned") ?? undefined,
    notifyByEmail: formData.get("notifyByEmail") ?? undefined,
    expiresAt: formData.get("expiresAt") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const me = await currentUser();
  const shouldEmail = parsed.data.notifyByEmail === "on";

  // Insert first so the row exists even if the email fan-out fails or
  // hits a Resend rate limit. Returning the id lets us stamp emailed_at
  // afterwards.
  const [inserted] = await forTenant(m.tenant.id).run((tx) =>
    tx
      .insert(scAnnouncements)
      .values({
        traceyTenantId: m.tenant.id,
        title: parsed.data.title,
        body: parsed.data.body,
        pinned: parsed.data.pinned === "on",
        expiresAt: parseExpiresOrNull(parsed.data.expiresAt),
        createdByUserId: me?.id ?? null,
      })
      .returning({ id: scAnnouncements.id }),
  );

  await logAuditEvent({
    action: "shiftcraft.announcement.created",
    targetKind: "sc_announcement",
    targetId: inserted?.id,
    details: {
      title: parsed.data.title,
      pinned: parsed.data.pinned === "on",
      emailRequested: shouldEmail,
    },
  });

  if (shouldEmail && inserted) {
    // Resolve every tenant member's id + email + name. Filtering on
    // members.tenantId scopes the blast to this tenant only — RLS isn't
    // enforced on app.members (per the schema comment) so we rely on the
    // WHERE here.
    const recipients = await db
      .select({
        userId: appUsers.id,
        email: appUsers.email,
        name: appUsers.name,
      })
      .from(members)
      .innerJoin(appUsers, eq(appUsers.id, members.userId))
      .where(eq(members.tenantId, m.tenant.id));

    // Don't email the author back. The dashboard banner already covers
    // them when they next load /app.
    const recipientsExcludingAuthor = me
      ? recipients.filter((r) => r.email !== me.email)
      : recipients;

    // Honour per-user opt-outs. The unsubscribe set is fetched once,
    // not per recipient — large tenants stay O(1) round-trips.
    const unsubscribed = await getUnsubscribedUserIds(
      m.tenant.id,
      "announcements",
    );
    const filteredRecipients = recipientsExcludingAuthor.filter(
      (r) => !unsubscribed.has(r.userId),
    );

    const sent = await notifyAnnouncementPosted({
      recipients: filteredRecipients,
      postedBy: { name: me?.name ?? null, email: me?.email ?? "system" },
      tenantName: m.tenant.name,
      title: parsed.data.title,
      body: parsed.data.body,
    });

    // Record what was attempted. emailed_at is "the moment we decided to
    // fan out", not "every individual delivery confirmed" — Resend's
    // delivery telemetry is a separate concern.
    await forTenant(m.tenant.id).run((tx) =>
      tx
        .update(scAnnouncements)
        .set({
          emailedAt: new Date(),
          emailedRecipientCount: sent,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(scAnnouncements.id, inserted.id),
            eq(scAnnouncements.traceyTenantId, m.tenant.id),
          ),
        ),
    );

    await logAuditEvent({
      action: "shiftcraft.announcement.emailed",
      targetKind: "sc_announcement",
      targetId: inserted.id,
      details: { recipientCount: sent },
    });
  }

  revalidatePath("/app/announcements");
  revalidatePath("/app");
  redirect("/app/announcements?added=1");
}

export async function togglePinnedAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const nextRaw = String(formData.get("pinned") ?? "");
  if (!id) return;
  const m = await currentMembership();
  if (!m) return;
  if (requireAdmin(m.role) !== true) return;

  const nextPinned = nextRaw === "true";
  await forTenant(m.tenant.id).run((tx) =>
    tx
      .update(scAnnouncements)
      .set({ pinned: nextPinned, updatedAt: new Date() })
      .where(
        and(
          eq(scAnnouncements.id, id),
          eq(scAnnouncements.traceyTenantId, m.tenant.id),
        ),
      ),
  );
  revalidatePath("/app/announcements");
  revalidatePath("/app");
}

export async function deleteAnnouncementAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const m = await currentMembership();
  if (!m) return;
  if (requireAdmin(m.role) !== true) return;

  await forTenant(m.tenant.id).run((tx) =>
    tx
      .delete(scAnnouncements)
      .where(
        and(
          eq(scAnnouncements.id, id),
          eq(scAnnouncements.traceyTenantId, m.tenant.id),
        ),
      ),
  );
  revalidatePath("/app/announcements");
  revalidatePath("/app");
}
