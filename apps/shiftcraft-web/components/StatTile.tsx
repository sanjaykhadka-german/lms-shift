import * as React from "react";
import Link from "next/link";
import { MiniBars } from "~/components/MiniBars";
import { cn } from "~/lib/utils";

type Tone = "neutral" | "live" | "warn";

const VALUE_TONE: Record<Tone, string> = {
  neutral: "text-ink",
  live: "text-live",
  warn: "text-warn",
};

/**
 * Glanceable dashboard stat tile — mono uppercase label, a large display value
 * tinted by `tone`, an optional hint, and an optional inline bar sparkline.
 * Wraps in a link when `href` is given. Lifts on hover.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  trend,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  trend?: number[];
  href?: string;
}) {
  const inner = (
    <>
      <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 font-display text-3xl font-semibold leading-none tracking-[-0.01em]",
          VALUE_TONE[tone],
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-xs text-ink-3">{hint}</div> : null}
      {trend && trend.length > 0 ? (
        <MiniBars values={trend} className="mt-3" />
      ) : null}
    </>
  );

  const cls =
    "block rounded-lg border border-border bg-card p-4 shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow";

  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}
