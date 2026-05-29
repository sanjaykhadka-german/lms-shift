import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--ring)] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[color:var(--primary)] text-[color:var(--primary-foreground)]",
        secondary:
          "border-transparent bg-[color:var(--secondary)] text-[color:var(--secondary-foreground)]",
        outline: "border-[color:var(--border)] text-[color:var(--foreground)]",
        destructive:
          "border-transparent bg-[color:var(--destructive)] text-[color:var(--destructive-foreground)]",
        success:
          "border-transparent bg-emerald-600 text-white",
        warning: "border-transparent bg-amber-600 text-white",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
