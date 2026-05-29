"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scLocations } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

// Geofence input coerce: blank → null, otherwise a finite number in
// the valid range; out-of-range fails the schema and the form shows
// a field error.
const geofenceLatField = z
  .union([
    z.literal(""),
    z.coerce.number().refine(
      (n) => Number.isFinite(n) && n >= -90 && n <= 90,
      "Latitude must be between -90 and 90",
    ),
  ])
  .optional();
const geofenceLngField = z
  .union([
    z.literal(""),
    z.coerce.number().refine(
      (n) => Number.isFinite(n) && n >= -180 && n <= 180,
      "Longitude must be between -180 and 180",
    ),
  ])
  .optional();
const geofenceRadiusField = z
  .union([
    z.literal(""),
    z.coerce.number().int().refine(
      (n) => Number.isFinite(n) && n >= 1 && n <= 5000,
      "Radius must be between 1 and 5000 metres",
    ),
  ])
  .optional();

// Wage-budget guardrail. Blank → null (no budget). Otherwise a
// non-negative dollar figure; the DB column is numeric(10,2) so the
// practical ceiling is 99,999,999.99 — far beyond any sane daily wage
// bill. We store it as a string to match Drizzle's numeric handling.
const dailyWageBudgetField = z
  .union([
    z.literal(""),
    z.coerce.number().refine(
      (n) => Number.isFinite(n) && n >= 0 && n <= 99_999_999,
      "Budget must be a positive dollar amount",
    ),
  ])
  .optional();

const locationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Too long"),
  timezone: z.string().trim().min(1, "Timezone is required").max(64),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  color: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(/^#[0-9a-f]{6}$/i, "Use a #RRGGBB hex value like #7C1F1F"),
    ])
    .optional(),
  lat: geofenceLatField,
  lng: geofenceLngField,
  geofenceRadiusM: geofenceRadiusField,
  dailyWageBudget: dailyWageBudgetField,
});

function coerceCoord(v: number | "" | undefined): number | null {
  return typeof v === "number" ? v : null;
}

// numeric columns round-trip through Drizzle as strings. Blank/undefined
// → null; a number → its fixed 2-decimal string form.
function coerceBudget(v: number | "" | undefined): string | null {
  return typeof v === "number" ? v.toFixed(2) : null;
}

function emptyToNull(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function requireTenant() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace to manage locations.");
  return m.tenant;
}

export async function createLocationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = locationSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    address: formData.get("address") ?? "",
    color: formData.get("color") ?? "",
    lat: formData.get("lat") ?? "",
    lng: formData.get("lng") ?? "",
    geofenceRadiusM: formData.get("geofenceRadiusM") ?? "",
    dailyWageBudget: formData.get("dailyWageBudget") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx.insert(scLocations).values({
      name: parsed.data.name,
      timezone: parsed.data.timezone,
      address: emptyToNull(parsed.data.address),
      color: emptyToNull(parsed.data.color)?.toLowerCase() ?? null,
      lat: coerceCoord(parsed.data.lat),
      lng: coerceCoord(parsed.data.lng),
      geofenceRadiusM: coerceCoord(parsed.data.geofenceRadiusM),
      dailyWageBudget: coerceBudget(parsed.data.dailyWageBudget),
      traceyTenantId: tenant.id,
    }),
  );
  revalidatePath("/app/locations");
  return { status: "ok", message: `Added ${parsed.data.name}.` };
}

export async function updateLocationAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = locationSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    address: formData.get("address") ?? "",
    color: formData.get("color") ?? "",
    lat: formData.get("lat") ?? "",
    lng: formData.get("lng") ?? "",
    geofenceRadiusM: formData.get("geofenceRadiusM") ?? "",
    dailyWageBudget: formData.get("dailyWageBudget") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(scLocations)
      .set({
        name: parsed.data.name,
        timezone: parsed.data.timezone,
        address: emptyToNull(parsed.data.address),
        color: emptyToNull(parsed.data.color)?.toLowerCase() ?? null,
        lat: coerceCoord(parsed.data.lat),
        lng: coerceCoord(parsed.data.lng),
        geofenceRadiusM: coerceCoord(parsed.data.geofenceRadiusM),
        dailyWageBudget: coerceBudget(parsed.data.dailyWageBudget),
      })
      .where(and(eq(scLocations.id, id), eq(scLocations.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/locations");
  revalidatePath(`/app/locations/${id}/edit`);
  return { status: "ok", message: "Saved." };
}

export async function deleteLocationAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .delete(scLocations)
      .where(and(eq(scLocations.id, id), eq(scLocations.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/locations");
  redirect("/app/locations");
}
