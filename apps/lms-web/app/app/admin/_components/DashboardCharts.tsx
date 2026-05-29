"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PIE_COLORS = ["#10b981", "#ef4444", "#f59e0b", "#94a3b8"];
const PASSED_COLOR = "#10b981";
const FAILED_COLOR = "#ef4444";
const BAR_COLOR = "#3b82f6";

type Timeseries = Array<{ date: string; passed: number; failed: number }>;
type StatusBuckets = {
  completed: number;
  overdue: number;
  dueSoon: number;
  open: number;
};
type RateRow = { name: string; attempts: number; passRate: number };

export function DashboardCharts({
  timeseries,
  assignmentStatus,
  passRateByModule,
  passRateByDept,
}: {
  timeseries: Timeseries;
  assignmentStatus: StatusBuckets;
  passRateByModule: Array<{ title: string; attempts: number; passRate: number }>;
  passRateByDept: Array<{ name: string; attempts: number; passRate: number }>;
}) {
  const moduleData: RateRow[] = passRateByModule.map((m) => ({
    name: truncate(m.title, 24),
    attempts: m.attempts,
    passRate: Math.round(m.passRate * 100),
  }));
  const deptData: RateRow[] = passRateByDept.map((d) => ({
    name: truncate(d.name, 18),
    attempts: d.attempts,
    passRate: Math.round(d.passRate * 100),
  }));
  // Drop zero-value buckets — they still rendered a "Name: 0" label in
  // the previous layout, contributing to the Completed/Overdue label
  // collision the user reported.
  const pieData = [
    { name: "Completed", value: assignmentStatus.completed },
    { name: "Overdue", value: assignmentStatus.overdue },
    { name: "Due soon", value: assignmentStatus.dueSoon },
    { name: "Open", value: assignmentStatus.open },
  ].filter((d) => d.value > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Attempts (passed vs failed)">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={timeseries}>
            <defs>
              <linearGradient id="passedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PASSED_COLOR} stopOpacity={0.35} />
                <stop offset="100%" stopColor={PASSED_COLOR} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="failedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={FAILED_COLOR} stopOpacity={0.3} />
                <stop offset="100%" stopColor={FAILED_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Area
              type="monotone"
              dataKey="passed"
              stroke={PASSED_COLOR}
              strokeWidth={2}
              fill="url(#passedFill)"
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="failed"
              stroke={FAILED_COLOR}
              strokeWidth={2}
              fill="url(#failedFill)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Assignment status">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              outerRadius={90}
              labelLine={false}
              label={({ percent }: { percent?: number }) =>
                typeof percent === "number" && percent >= 0.04
                  ? `${Math.round(percent * 100)}%`
                  : ""
              }
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number, _name: string, p: { payload?: { name?: string } }) => [
                String(v),
                p.payload?.name ?? "",
              ]}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Pass rate by module (worst first)">
        <ResponsiveContainer width="100%" height={Math.max(260, moduleData.length * 28)}>
          <BarChart data={moduleData} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={140}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(v: number) => `${v}%`}
              labelFormatter={(l) => `Module: ${l}`}
            />
            <Bar dataKey="passRate" fill={BAR_COLOR} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Pass rate by department (best first)">
        <ResponsiveContainer width="100%" height={Math.max(260, deptData.length * 32)}>
          <BarChart data={deptData} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(v: number) => `${v}%`}
              labelFormatter={(l) => `Department: ${l}`}
            />
            <Bar dataKey="passRate" fill={PASSED_COLOR} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-4">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
