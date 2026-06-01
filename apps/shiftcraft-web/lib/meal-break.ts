// Meal-break compliance helper (AUDIT gap #3).
//
// Pure + framework-free — deliberately NO `import "server-only"` so the
// client clock panel (_panel.tsx) can import the threshold and predicate,
// and vitest can exercise the bands without a DOM or DB.
//
// Breaks are already *recorded* as break_start / break_end clock events;
// what was missing is *prompting* the worker before they blow past the
// limit. This module owns the rule; lib/clock.ts already gives us the
// continuous-work duration (segmentStartedAt resets on break_end, so the
// live "working" elapsed IS the unbroken run since the last break).

/**
 * Continuous work after which AU general-rule practice expects a meal
 * break — most retail / hospitality / manufacturing awards require an
 * unpaid meal break once a shift passes ~5 hours. Tenants can't override
 * this yet; a per-tenant award_profile field is the documented future
 * refinement (mirrors how OT thresholds already live in award_profile).
 */
export const MEAL_BREAK_THRESHOLD_MS = 5 * 60 * 60 * 1000;

/** How long before the hard threshold to start nudging, so the worker can
 *  plan the break rather than discover it after the fact. */
export const MEAL_BREAK_WARN_LEAD_MS = 30 * 60 * 1000;

export type MealBreakLevel = "ok" | "approaching" | "due";

/**
 * Classify a continuous-work duration into a prompt band:
 *   - "due"         : at/over the threshold — a break should be taken now
 *   - "approaching" : within the warning lead window before the threshold
 *   - "ok"          : nothing to prompt
 *
 * Pure: same inputs → same output. `thresholdMs` is injectable so a future
 * per-tenant override (or a test) can pass its own limit.
 */
export function mealBreakLevel(
  continuousWorkMs: number,
  thresholdMs: number = MEAL_BREAK_THRESHOLD_MS,
): MealBreakLevel {
  if (continuousWorkMs >= thresholdMs) return "due";
  const warnAt = Math.max(0, thresholdMs - MEAL_BREAK_WARN_LEAD_MS);
  if (continuousWorkMs >= warnAt) return "approaching";
  return "ok";
}
