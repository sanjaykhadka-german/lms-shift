import { cn } from "~/lib/utils";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  progressPercent?: number;
}

export function StatCard({ label, value, hint, progressPercent }: StatCardProps) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-4">
      <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && (
        <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{hint}</div>
      )}
      {typeof progressPercent === "number" && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--secondary)]">
          <div
            className={cn("h-full rounded-full bg-emerald-600")}
            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
          />
        </div>
      )}
    </div>
  );
}
