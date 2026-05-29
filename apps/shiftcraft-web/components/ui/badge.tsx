import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-mono text-[10.5px] font-medium uppercase tracking-[0.05em]",
  {
    variants: {
      variant: {
        live: "bg-[color-mix(in_srgb,var(--live)_14%,transparent)] text-[var(--live)]",
        open: "bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--accent-deep)] dark:text-[var(--accent)]",
        neutral: "bg-line-soft text-ink-2",
        warn: "bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-[var(--warn)]",
        danger: "bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-[var(--danger)]",
        accent: "bg-[var(--accent)] text-[var(--accent-ink)]",
      },
      size: {
        default: "px-2.5 py-1",
        sm: "px-2 py-0.5 text-[10px]",
      },
    },
    defaultVariants: { variant: "neutral", size: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Show a leading status dot. `live` pulses. */
  dot?: boolean;
}

export function Badge({ className, variant, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && (
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full bg-current",
            variant === "live" && "animate-[sc-pulse_1.8s_infinite]",
          )}
        />
      )}
      {children}
    </span>
  );
}

export { badgeVariants };
