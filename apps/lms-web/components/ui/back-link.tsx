import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "~/lib/utils";

export interface BackLinkProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Link>, "children"> {
  children: React.ReactNode;
}

export const BackLink = React.forwardRef<HTMLAnchorElement, BackLinkProps>(
  ({ className, children, ...props }, ref) => (
    <Link
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]",
        className,
      )}
      {...props}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      <span>{children}</span>
    </Link>
  ),
);
BackLink.displayName = "BackLink";
