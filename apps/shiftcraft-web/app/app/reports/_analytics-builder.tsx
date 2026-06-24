"use client";

import { usePathname, useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";

// One enriched row per member for the selected week. Dimension fields are
// strings (group-by keys); metric fields are raw numbers so all formatting
// stays here in the client (we must NOT import lib/clock — it pulls the
// server-only db into the bundle).
export interface AnalyticsRow {
  employee: string;
  department: string;
  location: string;
  position: string;
  employmentType: string;
  hoursMs: number;
  prevHoursMs: number;
  wageCost: number;
}

type DimensionKey =
  | "employee"
  | "department"
  | "location"
  | "position"
  | "employmentType";

type MetricKey = "hours" | "wageCost" | "headcount" | "avgHours" | "delta";

const DIMENSIONS: { key: DimensionKey; label: string }[] = [
  { key: "employee", label: "Employee" },
  { key: "department", label: "Department" },
  { key: "location", label: "Location" },
  { key: "position", label: "Position" },
  { key: "employmentType", label: "Employment type" },
];

const METRICS: { key: MetricKey; label: string; help: string }[] = [
  { key: "hours", label: "Total hours", help: "Hours worked this week" },
  { key: "wageCost", label: "Wage cost", help: "Rate × hours" },
  { key: "headcount", label: "Headcount", help: "People with hours" },
  { key: "avgHours", label: "Avg / person", help: "Hours ÷ headcount" },
  { key: "delta", label: "vs prev period", help: "Change in hours vs the preceding period of equal length" },
];

function fmtHours(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0h 0m";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function fmtMoney(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "$0.00";
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface Group {
  key: string;
  hoursMs: number;
  prevHoursMs: number;
  wageCost: number;
  headcount: number;
}

function emptyGroup(key: string): Group {
  return { key, hoursMs: 0, prevHoursMs: 0, wageCost: 0, headcount: 0 };
}

function addRow(g: Group, r: AnalyticsRow) {
  g.hoursMs += r.hoursMs;
  g.prevHoursMs += r.prevHoursMs;
  g.wageCost += r.wageCost;
  if (r.hoursMs > 0) g.headcount += 1;
}

function metricValue(g: Group, m: MetricKey): number {
  switch (m) {
    case "hours":
      return g.hoursMs;
    case "wageCost":
      return g.wageCost;
    case "headcount":
      return g.headcount;
    case "avgHours":
      return g.hoursMs / Math.max(1, g.headcount);
    case "delta":
      return g.hoursMs - g.prevHoursMs;
  }
}

function fmtMetric(g: Group, m: MetricKey): string {
  switch (m) {
    case "hours":
      return fmtHours(g.hoursMs);
    case "wageCost":
      return fmtMoney(g.wageCost);
    case "headcount":
      return String(g.headcount);
    case "avgHours":
      return fmtHours(g.hoursMs / Math.max(1, g.headcount));
    case "delta": {
      const d = g.hoursMs - g.prevHoursMs;
      if (d === 0) return "±0";
      return `${d > 0 ? "+" : "−"}${fmtHours(Math.abs(d))}`;
    }
  }
}

// Signed metrics (delta) get a red/green tint; the rest stay neutral.
function deltaClass(g: Group, m: MetricKey): string {
  if (m !== "delta") return "";
  const d = g.hoursMs - g.prevHoursMs;
  if (d === 0) return "text-muted-foreground";
  return d > 0 ? "text-[var(--live)]" : "text-[color:var(--destructive)]";
}

const RANGE_PRESETS: { key: string; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "lastweek", label: "Last week" },
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "quarter", label: "This quarter" },
  { key: "custom", label: "Custom" },
];

export function AnalyticsBuilder({
  rows,
  locationPeriodBudgets = {},
  rangeKey,
  rangeLabel,
  rangeDays,
  customStart,
  customEnd,
  baseWeek = null,
  baseDepartment = null,
}: {
  rows: AnalyticsRow[];
  locationPeriodBudgets?: Record<string, number>;
  rangeKey: string;
  rangeLabel: string;
  rangeDays: number;
  customStart: string;
  customEnd: string;
  baseWeek?: string | null;
  baseDepartment?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [dimension, setDimension] = useState<DimensionKey>("department");
  const [view, setView] = useState<"table" | "chart">("table");
  // Custom-range inputs (only navigate on Apply). Open when the server
  // already resolved a custom range.
  const [customOpen, setCustomOpen] = useState(rangeKey === "custom");
  const [cStart, setCStart] = useState(customStart);
  const [cEnd, setCEnd] = useState(customEnd);

  // Navigate to a new analytics range, preserving the page's week +
  // department params.
  function go(params: Record<string, string>) {
    const sp = new URLSearchParams();
    if (baseWeek) sp.set("week", baseWeek);
    if (baseDepartment) sp.set("department", baseDepartment);
    for (const [k, v] of Object.entries(params)) sp.set(k, v);
    router.push(`${pathname}?${sp.toString()}`);
  }

  function selectPreset(key: string) {
    if (key === "custom") {
      setCustomOpen(true);
      return; // wait for Apply
    }
    setCustomOpen(false);
    go({ arange: key });
  }

  // Ordered selection drives the displayed columns. Keep at least one.
  const [metrics, setMetrics] = useState<MetricKey[]>([
    "hours",
    "wageCost",
    "headcount",
  ]);
  // Independent sort: which metric column orders the table / drives the chart.
  const [sortMetric, setSortMetric] = useState<MetricKey>("hours");
  const [sortDesc, setSortDesc] = useState(true);
  // Drill-down: which group rows are expanded to show their members.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Each group is a single person when grouping by employee — nothing to
  // drill into.
  const drillable = dimension !== "employee";

  function toggleMetric(m: MetricKey) {
    setMetrics((prev) => {
      if (prev.includes(m)) {
        if (prev.length === 1) return prev; // always show one column
        const next = prev.filter((x) => x !== m);
        if (sortMetric === m) setSortMetric(next[0]!);
        return next;
      }
      return [...prev, m];
    });
  }

  function sortByColumn(m: MetricKey) {
    if (sortMetric === m) {
      setSortDesc((d) => !d);
    } else {
      setSortMetric(m);
      setSortDesc(true);
    }
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Group the rows and remember each group's members for drill-down.
  const { groups, totals, membersByGroup } = useMemo(() => {
    const map = new Map<string, Group>();
    const members = new Map<string, Group[]>();
    const totals = emptyGroup("Total");
    for (const r of rows) {
      const key = (r[dimension] || "Unassigned").toString();
      const g = map.get(key) ?? emptyGroup(key);
      addRow(g, r);
      map.set(key, g);
      // Member sub-row (one person) for the expand panel.
      const mem = emptyGroup(r.employee);
      addRow(mem, r);
      const list = members.get(key) ?? [];
      list.push(mem);
      members.set(key, list);
      addRow(totals, r);
    }
    const dir = sortDesc ? 1 : -1;
    const groups = Array.from(map.values()).sort(
      (a, b) =>
        (metricValue(b, sortMetric) - metricValue(a, sortMetric)) * dir ||
        a.key.localeCompare(b.key),
    );
    for (const list of members.values()) {
      list.sort(
        (a, b) =>
          metricValue(b, sortMetric) - metricValue(a, sortMetric) ||
          a.key.localeCompare(b.key),
      );
    }
    return { groups, totals, membersByGroup: members };
  }, [rows, dimension, sortMetric, sortDesc]);

  const dimensionLabel =
    DIMENSIONS.find((d) => d.key === dimension)?.label ?? "Group";
  const sortMetricLabel =
    METRICS.find((m) => m.key === sortMetric)?.label ?? "";
  // Keep the configured column order stable regardless of toggle order.
  const orderedMetrics = METRICS.filter((m) => metrics.includes(m.key));
  // Bars scale to the largest absolute value in the active metric column.
  const sortMax = Math.max(
    0,
    ...groups.map((g) => Math.abs(metricValue(g, sortMetric))),
  );
  const sortTotal = metricValue(totals, sortMetric);
  const showBudget = dimension === "location";

  function budgetLine(g: Group) {
    if (!showBudget) return null;
    const budget = locationPeriodBudgets[g.key];
    if (!budget) return null;
    const pct = (g.wageCost / budget) * 100;
    const over = g.wageCost > budget;
    return (
      <div
        className={`mt-1 text-[10px] tabular-nums ${
          over
            ? "text-[color:var(--destructive)]"
            : "text-muted-foreground"
        }`}
        title={`Wage budget for this range = daily budget × ${rangeDays} day${
          rangeDays === 1 ? "" : "s"
        }`}
      >
        {fmtMoney(g.wageCost)} / {fmtMoney(budget)} budget · {pct.toFixed(0)}%
        {over ? " · over" : ""}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Header + controls */}
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Custom analytics</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choose a date range, how to group the data, and which columns to
              compare. The department filter above still applies.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium tabular-nums text-muted-foreground">
              {groups.length} {groups.length === 1 ? "group" : "groups"}
            </span>
            {/* View toggle */}
            <div className="inline-flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
              {(["table", "chart"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${
                    view === v
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Date range — presets + optional custom window */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Range
          </span>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {RANGE_PRESETS.map((p) => {
              const on =
                p.key === "custom"
                  ? rangeKey === "custom" || customOpen
                  : rangeKey === p.key && !customOpen;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => selectPreset(p.key)}
                  aria-pressed={on}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    on
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {rangeLabel}
          </span>
        </div>

        {customOpen && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={cStart}
              max={cEnd || undefined}
              onChange={(e) => setCStart(e.target.value)}
              className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={cEnd}
              min={cStart || undefined}
              onChange={(e) => setCEnd(e.target.value)}
              className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
            />
            <button
              type="button"
              disabled={!cStart || !cEnd || cEnd < cStart}
              onClick={() =>
                go({ arange: "custom", astart: cStart, aend: cEnd })
              }
              className="h-8 rounded-md border border-primary/40 bg-primary/15 px-3 text-xs font-medium text-foreground transition hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        )}

        {/* Group-by — segmented control */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Group by
          </span>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {DIMENSIONS.map((d) => {
              const on = d.key === dimension;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => {
                    setDimension(d.key);
                    setExpanded(new Set());
                  }}
                  aria-pressed={on}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    on
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Metric chips — in table view they pick columns; in chart view the
            active (filled) one is what's plotted. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {view === "chart" ? "Metric" : "Columns"}
          </span>
          {METRICS.map((m) => {
            const on =
              view === "chart" ? sortMetric === m.key : metrics.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                onClick={() =>
                  view === "chart" ? setSortMetric(m.key) : toggleMetric(m.key)
                }
                aria-pressed={on}
                title={m.help}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                  on
                    ? "border-primary/40 bg-primary/15 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    on ? "bg-primary" : "bg-muted-foreground/40"
                  }`}
                />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          No data for this period.
        </p>
      ) : view === "chart" ? (
        /* ── Chart view ── horizontal bars of the active metric ── */
        <div className="space-y-2.5 px-5 py-5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {sortMetricLabel} by {dimensionLabel.toLowerCase()}
          </div>
          {groups.map((g) => {
            const val = metricValue(g, sortMetric);
            const barPct = sortMax > 0 ? (Math.abs(val) / sortMax) * 100 : 0;
            const negative = sortMetric === "delta" && val < 0;
            return (
              <div key={g.key} className="flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-xs font-medium text-foreground sm:w-44">
                  {g.key}
                </div>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted/50">
                  <div
                    className={`h-full rounded ${
                      negative ? "bg-[color:var(--destructive)]/55" : "bg-primary/55"
                    }`}
                    style={{ width: `${Math.max(2, barPct)}%` }}
                  />
                </div>
                <div
                  className={`w-24 shrink-0 text-right font-mono text-xs font-semibold tabular-nums ${deltaClass(
                    g,
                    sortMetric,
                  )}`}
                >
                  {fmtMetric(g, sortMetric)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Table view ── */
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">
                  {dimensionLabel}
                </th>
                {orderedMetrics.map((m) => {
                  const active = sortMetric === m.key;
                  return (
                    <th
                      key={m.key}
                      className="px-3 py-2.5 text-right font-medium"
                    >
                      <button
                        type="button"
                        onClick={() => sortByColumn(m.key)}
                        title={`Sort by ${m.label}`}
                        className={`ml-auto inline-flex items-center gap-1 transition hover:text-foreground ${
                          active ? "text-foreground" : ""
                        }`}
                      >
                        {m.label}
                        <span
                          className={`text-[9px] leading-none ${
                            active ? "opacity-100" : "opacity-30"
                          }`}
                        >
                          {active ? (sortDesc ? "▼" : "▲") : "▾"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groups.map((g) => {
                const share =
                  sortTotal > 0
                    ? (metricValue(g, sortMetric) / sortTotal) * 100
                    : 0;
                const barPct =
                  sortMax > 0
                    ? (Math.abs(metricValue(g, sortMetric)) / sortMax) * 100
                    : 0;
                const isOpen = expanded.has(g.key);
                const members = membersByGroup.get(g.key) ?? [];
                return (
                  <Fragment key={g.key}>
                    <tr
                      className={`transition-colors hover:bg-muted/30 ${
                        drillable ? "cursor-pointer" : ""
                      }`}
                      onClick={
                        drillable ? () => toggleExpanded(g.key) : undefined
                      }
                    >
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {drillable && (
                            <span
                              className={`text-[9px] text-muted-foreground transition-transform ${
                                isOpen ? "rotate-90" : ""
                              }`}
                            >
                              ▶
                            </span>
                          )}
                          <span className="font-medium text-foreground">
                            {g.key}
                          </span>
                          {drillable && (
                            <span className="text-[10px] text-muted-foreground">
                              ({members.length})
                            </span>
                          )}
                        </div>
                        {sortTotal > 0 && (
                          <div
                            className={`mt-1 flex items-center gap-2 ${
                              drillable ? "pl-[15px]" : ""
                            }`}
                          >
                            <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary/50"
                                style={{ width: `${Math.max(2, barPct)}%` }}
                              />
                            </div>
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {share.toFixed(0)}%
                            </span>
                          </div>
                        )}
                        {budgetLine(g)}
                      </td>
                      {orderedMetrics.map((m) => {
                        const active = sortMetric === m.key;
                        return (
                          <td
                            key={m.key}
                            className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                              active
                                ? "font-semibold text-foreground"
                                : "text-muted-foreground"
                            } ${deltaClass(g, m.key)}`}
                          >
                            {fmtMetric(g, m.key)}
                          </td>
                        );
                      })}
                    </tr>
                    {/* Drill-down: member sub-rows */}
                    {isOpen &&
                      members.map((mem) => (
                        <tr
                          key={`${g.key}::${mem.key}`}
                          className="bg-muted/15 text-xs"
                        >
                          <td className="py-1.5 pl-12 pr-5 text-muted-foreground">
                            {mem.key}
                          </td>
                          {orderedMetrics.map((m) => (
                            <td
                              key={m.key}
                              className={`px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground ${deltaClass(
                                mem,
                                m.key,
                              )}`}
                            >
                              {fmtMetric(mem, m.key)}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-border bg-muted/30">
              <tr>
                <td className="px-5 py-2.5 text-sm font-semibold">Total</td>
                {orderedMetrics.map((m) => (
                  <td
                    key={m.key}
                    className="px-3 py-2.5 text-right font-mono text-sm font-semibold tabular-nums"
                  >
                    {/* Avg / person at the total level uses the overall
                        headcount, not a sum of per-group averages. */}
                    {fmtMetric(totals, m.key)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
