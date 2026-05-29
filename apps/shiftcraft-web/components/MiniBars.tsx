import { cn } from "~/lib/utils";

/**
 * Compact per-day bar chart (e.g. Mon–Sun hours). Values are normalised to the
 * max; the `highlightIndex` bar is tinted lime (used to mark Friday/peak day).
 */
export function MiniBars({
  values,
  highlightIndex,
  className,
  barClassName,
}: {
  values: number[];
  highlightIndex?: number;
  className?: string;
  barClassName?: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className={cn("flex h-8 items-end gap-[3px]", className)}>
      {values.map((v, i) => (
        <span
          key={i}
          className={cn(
            "w-1.5 flex-1 rounded-[2px]",
            i === highlightIndex ? "bg-[var(--accent)]" : "bg-[var(--ink)]/80",
            barClassName,
          )}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
