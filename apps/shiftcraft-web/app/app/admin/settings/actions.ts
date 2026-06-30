"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scTenantConfig, type ScHolidayRegion } from "@tracey/db";
import { getAwardPreset } from "@tracey/award";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isWorkspaceAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { HOLIDAY_REGIONS } from "~/lib/holidays";
import { _parseAwardProfile } from "~/lib/timesheet-classifier";

const regionSchema = z.object({
  region: z.enum(HOLIDAY_REGIONS),
});

export type SettingsFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export async function setHolidayRegionAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isWorkspaceAdmin(membership.role)) {
    return {
      status: "error",
      message: "Only Managers and Admins can change workspace settings.",
    };
  }
  const tenantId = membership.tenant.id;

  const parsed = regionSchema.safeParse({ region: formData.get("region") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Pick a valid region.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const newRegion = parsed.data.region as ScHolidayRegion;

  // Pull the previous value so the audit row has a meaningful before/after.
  // Returns undefined when no config row exists yet — first save creates it.
  const [prev] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ region: scTenantConfig.holidayRegion })
      .from(scTenantConfig)
      .where(eq(scTenantConfig.traceyTenantId, tenantId))
      .limit(1),
  );
  const previousRegion = (prev?.region as ScHolidayRegion | undefined) ?? "national";

  // No-op shortcut: same region selected. Don't write an audit event for
  // a non-change — the timeline stays signal-rich.
  if (previousRegion === newRegion && prev) {
    return { status: "ok", message: "Holiday region unchanged." };
  }

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scTenantConfig)
      .values({
        traceyTenantId: tenantId,
        holidayRegion: newRegion,
        updatedByUserId: me.id,
      })
      .onConflictDoUpdate({
        target: scTenantConfig.traceyTenantId,
        set: {
          holidayRegion: newRegion,
          updatedByUserId: me.id,
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.tenant.holiday_region_changed",
    targetKind: "tenant",
    targetId: tenantId,
    details: { from: previousRegion, to: newRegion },
  });

  revalidatePath("/app/admin/settings");
  return { status: "ok", message: "Holiday region saved." };
}

// ─── Award profile (Phase 2 #3b.5) ───────────────────────────────────
//
// Parses the form into a partial AwardProfileOverrides JSON, stores it
// on sc_tenant_config.award_profile (jsonb). Blank fields drop out so
// the stored profile contains ONLY the overrides — the helper merges
// with @tracey/award defaults on read. "Reset" submission clears the
// column entirely.

// Coerce a form text field into a positive number, or null when blank
// / non-finite. We accept commas + spaces as common typo'd inputs.
function asPositiveNumber(raw: FormDataEntryValue | null): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[\s,]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const awardProfileSchema = z.object({
  dailyOrdinaryMinutes: z.number().positive().optional(),
  dailyOvertimeMinutes: z.number().positive().optional(),
  weeklyOrdinaryMinutes: z.number().positive().optional(),
  overtimeBasis: z.enum(["daily", "weekly"]).optional(),
  weeklyOvertimeFirstTierMinutes: z.number().positive().optional(),
  overtimeMultiplier: z.number().positive().optional(),
  doubleOvertimeMultiplier: z.number().positive().optional(),
  penaltyWeekday: z.number().positive().optional(),
  penaltySaturday: z.number().positive().optional(),
  penaltySunday: z.number().positive().optional(),
  penaltyPublicHoliday: z.number().positive().optional(),
  costPolicy: z.enum(["max", "stack"]).optional(),
});

export async function setAwardProfileAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isWorkspaceAdmin(membership.role)) {
    return {
      status: "error",
      message: "Only Managers and Admins can change workspace settings.",
    };
  }
  const tenantId = membership.tenant.id;

  // Treat the "reset" intent as a separate branch — when the form is
  // submitted via the Reset button, every other field is empty and the
  // intent is to clear the column. Distinguished by a hidden input.
  const intent = String(formData.get("intent") ?? "save");
  if (intent === "reset") {
    await forTenant(tenantId).run((tx) =>
      tx
        .update(scTenantConfig)
        .set({ awardProfile: null, updatedByUserId: me.id, updatedAt: new Date() })
        .where(eq(scTenantConfig.traceyTenantId, tenantId)),
    );
    await logAuditEvent({
      action: "shiftcraft.tenant.award_profile_reset",
      targetKind: "tenant",
      targetId: tenantId,
      details: null,
    });
    revalidatePath("/app/admin/settings");
    return { status: "ok", message: "Award profile reset to defaults." };
  }

  // "apply_preset": stamp a named award's rule structure (thresholds +
  // multipliers) into award_profile and record the award code + effective
  // date. The numeric fields stay editable afterwards. The legally-binding
  // dollar rates are NOT set here — they come from the Fair Work pull.
  if (intent === "apply_preset") {
    const code = String(formData.get("awardCode") ?? "");
    const preset = getAwardPreset(code);
    if (!preset) {
      return { status: "error", message: "Pick a valid award to apply." };
    }
    const profile = preset.profile as Record<string, unknown>;
    await forTenant(tenantId).run((tx) =>
      tx
        .insert(scTenantConfig)
        .values({
          traceyTenantId: tenantId,
          awardProfile: profile,
          awardCode: preset.code,
          awardEffectiveFrom: preset.effectiveFrom,
          updatedByUserId: me.id,
        })
        .onConflictDoUpdate({
          target: scTenantConfig.traceyTenantId,
          set: {
            awardProfile: profile,
            awardCode: preset.code,
            awardEffectiveFrom: preset.effectiveFrom,
            updatedByUserId: me.id,
            updatedAt: new Date(),
          },
        }),
    );
    await logAuditEvent({
      action: "shiftcraft.tenant.award_profile_changed",
      targetKind: "tenant",
      targetId: tenantId,
      details: {
        awardCode: preset.code,
        effectiveFrom: preset.effectiveFrom,
        source: "preset",
      },
    });
    revalidatePath("/app/admin/settings");
    return {
      status: "ok",
      message: `Applied ${preset.name}. Verify rates via Fair Work before relying on them for pay.`,
    };
  }

  const raw = {
    dailyOrdinaryMinutes: asPositiveNumber(formData.get("dailyOrdinaryMinutes")),
    dailyOvertimeMinutes: asPositiveNumber(formData.get("dailyOvertimeMinutes")),
    weeklyOrdinaryMinutes: asPositiveNumber(formData.get("weeklyOrdinaryMinutes")),
    overtimeBasis:
      formData.get("overtimeBasis") === "daily" ||
      formData.get("overtimeBasis") === "weekly"
        ? (formData.get("overtimeBasis") as "daily" | "weekly")
        : undefined,
    weeklyOvertimeFirstTierMinutes: asPositiveNumber(
      formData.get("weeklyOvertimeFirstTierMinutes"),
    ),
    overtimeMultiplier: asPositiveNumber(formData.get("overtimeMultiplier")),
    doubleOvertimeMultiplier: asPositiveNumber(
      formData.get("doubleOvertimeMultiplier"),
    ),
    penaltyWeekday: asPositiveNumber(formData.get("penaltyWeekday")),
    penaltySaturday: asPositiveNumber(formData.get("penaltySaturday")),
    penaltySunday: asPositiveNumber(formData.get("penaltySunday")),
    penaltyPublicHoliday: asPositiveNumber(formData.get("penaltyPublicHoliday")),
    costPolicy:
      formData.get("costPolicy") === "max" ||
      formData.get("costPolicy") === "stack"
        ? (formData.get("costPolicy") as "max" | "stack")
        : undefined,
  };
  // Drop null entries so Zod's optional()s pass cleanly.
  const filtered = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== null && v !== undefined),
  );
  const parsed = awardProfileSchema.safeParse(filtered);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Sanity invariant: dailyOvertimeMinutes must be ≥ dailyOrdinaryMinutes
  // when both are set (matches the AwardThresholds invariant the
  // classifier enforces).
  if (
    parsed.data.dailyOrdinaryMinutes != null &&
    parsed.data.dailyOvertimeMinutes != null &&
    parsed.data.dailyOvertimeMinutes < parsed.data.dailyOrdinaryMinutes
  ) {
    return {
      status: "error",
      message:
        "Daily OT ceiling must be greater than or equal to daily ordinary minutes.",
      fieldErrors: {
        dailyOvertimeMinutes: [
          "Must be ≥ dailyOrdinaryMinutes for the OT 1.5× band to make sense.",
        ],
      },
    };
  }

  // Re-shape into the AwardProfileOverrides JSON the helper expects.
  const profile: Record<string, unknown> = {};
  const thresholds: Record<string, number | string> = {};
  if (parsed.data.dailyOrdinaryMinutes != null) {
    thresholds.dailyOrdinaryMinutes = parsed.data.dailyOrdinaryMinutes;
  }
  if (parsed.data.dailyOvertimeMinutes != null) {
    thresholds.dailyOvertimeMinutes = parsed.data.dailyOvertimeMinutes;
  }
  if (parsed.data.weeklyOrdinaryMinutes != null) {
    thresholds.weeklyOrdinaryMinutes = parsed.data.weeklyOrdinaryMinutes;
  }
  if (parsed.data.overtimeBasis != null) {
    thresholds.overtimeBasis = parsed.data.overtimeBasis;
  }
  if (parsed.data.weeklyOvertimeFirstTierMinutes != null) {
    thresholds.weeklyOvertimeFirstTierMinutes =
      parsed.data.weeklyOvertimeFirstTierMinutes;
  }
  if (Object.keys(thresholds).length > 0) profile.thresholds = thresholds;
  if (parsed.data.overtimeMultiplier != null) {
    profile.overtimeMultiplier = parsed.data.overtimeMultiplier;
  }
  if (parsed.data.doubleOvertimeMultiplier != null) {
    profile.doubleOvertimeMultiplier = parsed.data.doubleOvertimeMultiplier;
  }
  const pms: Record<string, number> = {};
  if (parsed.data.penaltyWeekday != null) pms.weekday = parsed.data.penaltyWeekday;
  if (parsed.data.penaltySaturday != null)
    pms.saturday = parsed.data.penaltySaturday;
  if (parsed.data.penaltySunday != null) pms.sunday = parsed.data.penaltySunday;
  if (parsed.data.penaltyPublicHoliday != null) {
    pms.public_holiday = parsed.data.penaltyPublicHoliday;
  }
  if (Object.keys(pms).length > 0) profile.penaltyMultipliers = pms;
  if (parsed.data.costPolicy) profile.costPolicy = parsed.data.costPolicy;

  // Final sanity-check via the parser the helper uses — if our shape
  // can't round-trip through it, refuse the save.
  const sanityCheck = _parseAwardProfile(profile);
  void sanityCheck;

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scTenantConfig)
      .values({
        traceyTenantId: tenantId,
        // Required column; respect lazy-default semantics.
        awardProfile: profile,
        updatedByUserId: me.id,
      })
      .onConflictDoUpdate({
        target: scTenantConfig.traceyTenantId,
        set: {
          awardProfile: profile,
          updatedByUserId: me.id,
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.tenant.award_profile_changed",
    targetKind: "tenant",
    targetId: tenantId,
    details: { profile },
  });

  revalidatePath("/app/admin/settings");
  return { status: "ok", message: "Award profile saved." };
}

// ─── Clock-in policy ──────────────────────────────────────────────────
//
// Five booleans on sc_tenant_config that control how staff clock in from
// the web app (not the kiosk). Submitted as checkboxes ("on"/absent).
// Enforced in app/app/clock/actions.ts → recordPunch and read via
// lib/clock-policy.ts.

export async function setClockPolicyAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isWorkspaceAdmin(membership.role)) {
    return {
      status: "error",
      message: "Only Managers and Admins can change workspace settings.",
    };
  }
  const tenantId = membership.tenant.id;

  const cb = (k: string) => formData.get(k) === "on";
  const values = {
    allowWebClock: cb("allowWebClock"),
    allowUnscheduledClockIn: cb("allowUnscheduledClockIn"),
    requireGeofence: cb("requireGeofence"),
    requireSelfie: cb("requireSelfie"),
    requireScheduledShift: cb("requireScheduledShift"),
  };

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scTenantConfig)
      .values({ traceyTenantId: tenantId, ...values, updatedByUserId: me.id })
      .onConflictDoUpdate({
        target: scTenantConfig.traceyTenantId,
        set: { ...values, updatedByUserId: me.id, updatedAt: new Date() },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.tenant.clock_policy_changed",
    targetKind: "tenant",
    targetId: tenantId,
    details: values,
  });

  revalidatePath("/app/admin/settings");
  revalidatePath("/app/clock");
  return { status: "ok", message: "Clock-in policy saved." };
}

// ─── Notification channel ─────────────────────────────────────────────
//
// How shift notifications (scheduled / offered) reach staff: by email, by
// in-app notification (+ push), or both. Stored on sc_tenant_config and read
// by the schedule actions via lib/notify-prefs.ts.

const notifyChannelSchema = z.object({
  channel: z.enum(["email", "in_app", "both"]),
});

export async function setNotifyChannelAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isWorkspaceAdmin(membership.role)) {
    return {
      status: "error",
      message: "Only Managers and Admins can change workspace settings.",
    };
  }
  const tenantId = membership.tenant.id;

  const parsed = notifyChannelSchema.safeParse({
    channel: formData.get("channel"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Pick a valid option." };
  }
  const channel = parsed.data.channel;

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scTenantConfig)
      .values({ traceyTenantId: tenantId, notifyChannel: channel, updatedByUserId: me.id })
      .onConflictDoUpdate({
        target: scTenantConfig.traceyTenantId,
        set: {
          notifyChannel: channel,
          updatedByUserId: me.id,
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.tenant.notify_channel_changed",
    targetKind: "tenant",
    targetId: tenantId,
    details: { channel },
  });

  revalidatePath("/app/admin/settings");
  return { status: "ok", message: "Notification settings saved." };
}
