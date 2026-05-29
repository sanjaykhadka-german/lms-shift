import {
  fmtHours,
  fmtMoney,
  type LabourForecast,
} from "~/lib/labour-forecast";

interface Props {
  forecast: LabourForecast;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Solid, saturated fills with white text — washed-out tint badges render
// poorly in this theme (see the Tailwind-v4 contrast note).
function budgetChip(cost: number, budget: number): {
  className: string;
  label: string;
} {
  if (cost > budget) {
    return {
      className: "bg-[var(--danger)] text-white",
      label: `${fmtMoney(cost - budget)} over`,
    };
  }
  // Within 10% of the cap → amber "tight" warning.
  if (cost >= budget * 0.9) {
    return {
      className: "bg-[var(--warn)] text-white",
      label: `${fmtMoney(budget - cost)} left`,
    };
  }
  return {
    className: "bg-[var(--live)] text-white",
    label: `${fmtMoney(budget - cost)} left`,
  };
}

export function WeeklyLabourForecast({ forecast }: Props) {
  const {
    totalCost,
    totalHours,
    shiftCount,
    uncoveredCount,
    missingRateCount,
    byLocation,
    weeklyBudgetTotal,
    dailyBudgetTotal,
    costByDay,
  } = forecast;

  if (shiftCount === 0) return null;

  const hasCaveats = uncoveredCount > 0 || missingRateCount > 0;
  const weeklyChip =
    weeklyBudgetTotal != null
      ? budgetChip(totalCost, weeklyBudgetTotal)
      : null;
  const weeklyPct =
    weeklyBudgetTotal != null && weeklyBudgetTotal > 0
      ? Math.min(100, Math.round((totalCost / weeklyBudgetTotal) * 100))
      : null;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Projected labour cost</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Based on published shifts this week × each accepted employee's
            hourly rate.
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <div className="text-2xl font-semibold tabular-nums">
              {fmtMoney(totalCost)}
            </div>
            {weeklyChip && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${weeklyChip.className}`}
              >
                {weeklyChip.label}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {fmtHours(totalHours)} across {shiftCount} shift
            {shiftCount === 1 ? "" : "s"}
            {weeklyBudgetTotal != null && (
              <> · of {fmtMoney(weeklyBudgetTotal)} weekly budget</>
            )}
          </div>
        </div>
      </div>

      {weeklyPct != null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${
              totalCost > (weeklyBudgetTotal ?? 0)
                ? "bg-[var(--danger)]"
                : weeklyPct >= 90
                  ? "bg-[var(--warn)]"
                  : "bg-[var(--live)]"
            }`}
            style={{ width: `${weeklyPct}%` }}
          />
        </div>
      )}

      {dailyBudgetTotal != null && (
        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Daily spend vs {fmtMoney(dailyBudgetTotal)}/day budget
          </div>
          <ul className="grid grid-cols-7 gap-1.5">
            {DAY_LABELS.map((label, i) => {
              const cost = costByDay[i] ?? 0;
              const over = cost > dailyBudgetTotal;
              const tight = !over && cost >= dailyBudgetTotal * 0.9 && cost > 0;
              return (
                <li
                  key={label}
                  className={`rounded-md border px-1.5 py-1 text-center ${
                    over
                      ? "border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]"
                      : tight
                        ? "border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)]"
                        : "border-border"
                  }`}
                  title={`${label}: ${fmtMoney(cost)} of ${fmtMoney(dailyBudgetTotal)}`}
                >
                  <div className="text-[10px] text-muted-foreground">
                    {label}
                  </div>
                  <div
                    className={`text-xs font-semibold tabular-nums ${
                      over
                        ? "text-[var(--danger)]"
                        : tight
                          ? "text-[var(--warn)]"
                          : "text-foreground"
                    }`}
                  >
                    {cost > 0 ? fmtMoney(cost) : "—"}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {byLocation.length > 1 && (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {byLocation.map((loc) => {
            const locChip =
              loc.weeklyBudget != null
                ? budgetChip(loc.cost, loc.weeklyBudget)
                : null;
            return (
              <li
                key={loc.locationId ?? "_none"}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="truncate">
                  {loc.locationName ?? "Unassigned"}
                </span>
                <span className="flex items-center gap-2 font-mono tabular-nums text-muted-foreground">
                  {fmtHours(loc.hours)} ·{" "}
                  <span className="font-semibold text-foreground">
                    {fmtMoney(loc.cost)}
                  </span>
                  {loc.weeklyBudget != null && (
                    <span className="text-xs text-muted-foreground">
                      / {fmtMoney(loc.weeklyBudget)}
                    </span>
                  )}
                  {locChip && (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${locChip.className}`}
                    >
                      {locChip.label}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {hasCaveats && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          {uncoveredCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--danger)] px-2 py-0.5 font-medium text-white">
              {uncoveredCount} uncovered shift
              {uncoveredCount === 1 ? "" : "s"}
            </span>
          )}
          {missingRateCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--warn)] px-2 py-0.5 font-medium text-white">
              {missingRateCount} accepted shift
              {missingRateCount === 1 ? "" : "s"} with no rate set
            </span>
          )}
          <span className="text-muted-foreground">
            — these aren't counted in the total.
          </span>
        </div>
      )}
    </section>
  );
}
