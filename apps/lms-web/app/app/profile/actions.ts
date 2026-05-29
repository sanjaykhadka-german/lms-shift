"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, lmsUsers, users } from "@tracey/db";
import { requireLearner } from "~/lib/lms/learner";
import { logAuditEvent } from "~/lib/audit";
import {
  deleteStoredPhoto,
  PhotoUploadError,
  saveUserPhoto,
} from "~/lib/lms/photos";
import { createClient } from "~/lib/supabase/server";
import { profileSchema, passwordSchema } from "./schemas";

export type ProfileFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const ctx = await requireLearner();
  const tid = ctx.traceyTenantId;
  const lmsUser = ctx.lmsUser;

  const parsed = profileSchema.safeParse({
    firstName: formData.get("first_name"),
    lastName: formData.get("last_name"),
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Photo handling. Three branches: new file → save+replace; remove checked
  // → null + delete previous; otherwise leave the column alone.
  const photoEntry = formData.get("photo");
  const removePhoto = formData.get("remove_photo") === "1";
  let nextPhotoFilename: string | null | undefined = undefined;
  if (photoEntry instanceof File && photoEntry.size > 0) {
    try {
      nextPhotoFilename = await saveUserPhoto({
        file: photoEntry,
        uploadedByLmsUserId: lmsUser.id,
        previousFilename: lmsUser.photoFilename,
        traceyTenantId: tid,
      });
    } catch (err) {
      if (err instanceof PhotoUploadError) {
        return {
          status: "error",
          message: err.message,
          fieldErrors: { photo: [err.message] },
        };
      }
      throw err;
    }
  } else if (removePhoto && lmsUser.photoFilename) {
    nextPhotoFilename = null;
    await deleteStoredPhoto(lmsUser.photoFilename, tid);
  }

  const fullName = `${data.firstName} ${data.lastName}`.trim();
  // allow-cross-tenant: public.users is excluded from RLS in 0004; updating own row by PK.
  await db
    .update(lmsUsers)
    .set({
      firstName: data.firstName,
      lastName: data.lastName,
      name: fullName,
      phone: data.phone,
      ...(nextPhotoFilename !== undefined
        ? { photoFilename: nextPhotoFilename }
        : {}),
    })
    .where(eq(lmsUsers.id, lmsUser.id));

  // Mirror the display name into Auth.js so the topbar greeting stays in sync.
  // allow-cross-tenant: Tracey app.users; uuid-keyed, not RLS-covered.
  await db
    .update(users)
    .set({ name: fullName, updatedAt: new Date() })
    .where(eq(users.id, ctx.traceyUserId));

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: lmsUser.email,
    action: "profile.updated",
    targetKind: "user",
    targetId: String(lmsUser.id),
    details: {
      photo:
        nextPhotoFilename === null
          ? "removed"
          : nextPhotoFilename
            ? "replaced"
            : "unchanged",
    },
  });

  revalidatePath("/app/profile");
  revalidatePath("/app", "layout");
  return { status: "ok", message: "Saved." };
}

export async function changePasswordAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const ctx = await requireLearner();

  const parsed = passwordSchema.safeParse({
    current: formData.get("current") ?? "",
    next: formData.get("next") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const supabase = await createClient();

  // Supabase has no standalone "verify password" call, so re-authenticate with
  // the current password as the check before updating to the new one.
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: ctx.lmsUser.email,
    password: data.current,
  });
  if (verifyErr) {
    return {
      status: "error",
      message: "Current password is incorrect.",
      fieldErrors: { current: ["That password doesn't match our records."] },
    };
  }

  const { error: updateErr } = await supabase.auth.updateUser({
    password: data.next,
  });
  if (updateErr) {
    return {
      status: "error",
      message: "Couldn't update your password. Please try again.",
    };
  }

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "profile.password_changed",
    targetKind: "user",
    targetId: String(ctx.lmsUser.id),
  });

  return { status: "ok", message: "Password updated." };
}
