import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--r-sm)] text-sm font-semibold transition-[transform,box-shadow,background,color,filter] duration-150 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Lime brand fill with ink text — the primary action everywhere.
        default:
          "bg-[var(--accent)] text-[var(--accent-ink)] shadow-[0_8px_18px_-10px_var(--accent-deep)] hover:brightness-[0.97]",
        // Ink fill — strong secondary / "dark" CTA.
        dark: "bg-[var(--ink)] text-[var(--paper)] hover:opacity-90",
        // Danger fill — destructive actions (clock-out, decline, delete).
        destructive: "bg-[var(--danger)] text-white hover:brightness-95",
        // Hairline outline on the paper canvas.
        outline:
          "border border-line bg-transparent text-ink hover:bg-paper-2",
        ghost: "text-ink hover:bg-paper-2",
        link: "text-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-[13px]",
        lg: "h-11 px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
