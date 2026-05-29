import * as React from "react";
import { cn } from "~/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-[var(--r-sm)] border border-line bg-[var(--paper)] px-3 py-1 text-sm text-ink shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-ink-3 focus-visible:border-[var(--accent-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
