"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scWebhookSubscriptions } from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  generateWebhookSecret,
  isKnownWebhookEvent,
  retryWebhookDelivery,
} from "~/lib/webhooks";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

async function requireManager() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(m.role)) {
    throw new Error("Only managers and admins can edit webhooks.");
  }
  return m;
}

const createSchema = z.object({
  event: z
    .string()
    .refine(isKnownWebhookEvent, "Pick a recognised event"),
  url: z
    .string()
    .trim()
    .url("Enter a valid HTTPS URL")
    .max(2000)
    .refine((s) => /^https?:\/\//i.test(s), "URL must start with http:// or https://"),
  label: z.string().trim().max(80).optional().or(z.literal("")),
});

export async function createSubscriptionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createSchema.safeParse({
    event: formData.get("event"),
    url: formData.get("url"),
    label: formData.get("label") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await requireManager();
  const user = await requireUser();
  const secret = generateWebhookSecret();

  await forTenant(membership.tenant.id).run((tx) =>
    tx.insert(scWebhookSubscriptions).values({
      traceyTenantId: membership.tenant.id,
      event: parsed.data.event,
      url: parsed.data.url,
      secret,
      label: parsed.data.label?.length ? parsed.data.label : null,
      createdByUserId: user.id,
    }),
  );

  await logAuditEvent({
    action: "shiftcraft.webhook.subscription_created",
    targetKind: "sc_webhook_subscription",
    details: { event: parsed.data.event, url: parsed.data.url },
  });

  revalidatePath("/app/admin/webhooks");
  return { status: "ok", message: "Subscription created. Secret revealed once below." };
}

export async function togglePauseAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const pause = formData.get("pause") === "1";
  if (!id) return;
  const membership = await requireManager();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scWebhookSubscriptions)
      .set({ isActive: !pause, updatedAt: new Date() })
      .where(
        and(
          eq(scWebhookSubscriptions.id, id),
          eq(scWebhookSubscriptions.traceyTenantId, membership.tenant.id),
        ),
      ),
  );
  await logAuditEvent({
    action: pause
      ? "shiftcraft.webhook.subscription_paused"
      : "shiftcraft.webhook.subscription_resumed",
    targetKind: "sc_webhook_subscription",
    targetId: id,
  });
  revalidatePath("/app/admin/webhooks");
}

export async function deleteSubscriptionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await requireManager();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .delete(scWebhookSubscriptions)
      .where(
        and(
          eq(scWebhookSubscriptions.id, id),
          eq(scWebhookSubscriptions.traceyTenantId, membership.tenant.id),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.webhook.subscription_deleted",
    targetKind: "sc_webhook_subscription",
    targetId: id,
  });
  revalidatePath("/app/admin/webhooks");
}

export async function rotateSecretAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await requireManager();
  const newSecret = generateWebhookSecret();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scWebhookSubscriptions)
      .set({ secret: newSecret, updatedAt: new Date() })
      .where(
        and(
          eq(scWebhookSubscriptions.id, id),
          eq(scWebhookSubscriptions.traceyTenantId, membership.tenant.id),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.webhook.secret_rotated",
    targetKind: "sc_webhook_subscription",
    targetId: id,
  });
  revalidatePath(`/app/admin/webhooks?reveal=${id}`);
}

export async function retryDeliveryAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await requireManager();
  await retryWebhookDelivery(membership.tenant.id, id);
  await logAuditEvent({
    action: "shiftcraft.webhook.delivery_retried",
    targetKind: "sc_webhook_delivery",
    targetId: id,
  });
  revalidatePath("/app/admin/webhooks");
}
