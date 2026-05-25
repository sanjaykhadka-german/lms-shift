"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scPushSubscriptions } from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(200),
  userAgent: z.string().max(500).optional().or(z.literal("")),
});

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export async function subscribePushAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = subscribeSchema.safeParse({
    endpoint: formData.get("endpoint"),
    p256dh: formData.get("p256dh"),
    auth: formData.get("auth"),
    userAgent: formData.get("userAgent") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: "Invalid subscription payload." };
  }
  const membership = await currentMembership();
  if (!membership) return { status: "error", message: "Not signed in." };
  const user = await requireUser();

  // Upsert on (tenant, user, endpoint) — re-subscribing from the
  // same browser refreshes the p256dh/auth keys without stacking
  // duplicate rows. The unique index handles the conflict target.
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .insert(scPushSubscriptions)
      .values({
        traceyTenantId: membership.tenant.id,
        appUserId: user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.p256dh,
        auth: parsed.data.auth,
        userAgent: parsed.data.userAgent?.length
          ? parsed.data.userAgent
          : null,
      })
      .onConflictDoUpdate({
        target: [
          scPushSubscriptions.traceyTenantId,
          scPushSubscriptions.appUserId,
          scPushSubscriptions.endpoint,
        ],
        set: {
          p256dh: parsed.data.p256dh,
          auth: parsed.data.auth,
          userAgent: parsed.data.userAgent?.length
            ? parsed.data.userAgent
            : null,
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.push.subscribed",
    targetKind: "sc_push_subscription",
    details: { endpoint: parsed.data.endpoint.slice(0, 80) },
  });

  revalidatePath("/app/settings");
  return { status: "ok", message: "Push notifications enabled on this device." };
}

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});

export async function unsubscribePushAction(
  formData: FormData,
): Promise<void> {
  const parsed = unsubscribeSchema.safeParse({
    endpoint: formData.get("endpoint"),
  });
  if (!parsed.success) return;
  const membership = await currentMembership();
  if (!membership) return;
  const user = await requireUser();

  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .delete(scPushSubscriptions)
      .where(
        and(
          eq(scPushSubscriptions.traceyTenantId, membership.tenant.id),
          eq(scPushSubscriptions.appUserId, user.id),
          eq(scPushSubscriptions.endpoint, parsed.data.endpoint),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.push.unsubscribed",
    targetKind: "sc_push_subscription",
    details: { endpoint: parsed.data.endpoint.slice(0, 80) },
  });

  revalidatePath("/app/settings");
}
