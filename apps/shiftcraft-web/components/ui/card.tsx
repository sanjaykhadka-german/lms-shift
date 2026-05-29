import * as React from "react";
import { cn } from "~/lib/utils";

/** Paper panel with hairline border + soft shadow (the --r-lg card surface). */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--r-lg)] border border-line bg-[var(--paper)] shadow-[var(--shadow-sm)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-line-soft px-[var(--pad,18px)] py-4",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-display text-[17px] font-semibold tracking-[-0.01em] text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-[var(--pad,18px)]", className)} {...props} />;
}

/** Mono uppercase eyebrow/label used above titles and on stat tiles. */
export function Eyebrow({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3",
        className,
      )}
      {...props}
    />
  );
}
