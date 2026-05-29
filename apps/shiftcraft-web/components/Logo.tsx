import { cn } from "~/lib/utils";

const SIZES = {
  sm: { mark: 28, font: "text-lg" },
  md: { mark: 34, font: "text-[1.4rem]" },
  lg: { mark: 44, font: "text-[1.9rem]" },
} as const;

/**
 * ShiftCraft "Clock Arc" mark — a lime rounded-square tile with an open clock
 * arc + two hands in accent-ink, beside the "Shift"/"Craft" wordmark.
 *
 * - `markOnly` renders just the tile (compact nav / favicon parity).
 * - `tone="onDark"` is for the auth ink aside / dark surfaces.
 */
export function ClockArcMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      className={className}
      aria-hidden
    >
      <rect x="2" y="2" width="48" height="48" rx="13" fill="var(--accent)" />
      <path
        d="M34 18a11 11 0 1 0 0 16"
        stroke="var(--accent-ink)"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <line
        x1="26"
        y1="26"
        x2="26"
        y2="17.5"
        stroke="var(--accent-ink)"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <line
        x1="26"
        y1="26"
        x2="32.5"
        y2="29"
        stroke="var(--accent-ink)"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({
  className,
  size = "md",
  markOnly = false,
  tone = "default",
}: {
  className?: string;
  size?: keyof typeof SIZES;
  markOnly?: boolean;
  tone?: "default" | "onDark";
}) {
  const { mark, font } = SIZES[size];
  if (markOnly) {
    return <ClockArcMark size={mark} className={className} />;
  }
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <ClockArcMark size={mark} />
      <span
        className={cn("font-display font-bold leading-none tracking-[-0.02em]", font)}
        style={{ color: tone === "onDark" ? "#f4eee3" : "var(--ink)" }}
      >
        Shift
        <span style={{ color: tone === "onDark" ? "rgba(244,238,227,.55)" : "var(--ink-2)" }}>
          Craft
        </span>
      </span>
    </span>
  );
}
