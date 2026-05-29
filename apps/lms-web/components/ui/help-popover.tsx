"use client";

import * as React from "react";
import { HelpCircle, Info } from "lucide-react";
import { cn } from "~/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";

export interface HelpPopoverProps {
  variant?: "info" | "help";
  label?: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  children: React.ReactNode;
}

export function HelpPopover({
  variant = "info",
  label,
  side = "top",
  className,
  children,
}: HelpPopoverProps) {
  const Icon = variant === "help" ? HelpCircle : Info;
  const ariaLabel = label ?? (variant === "help" ? "Help" : "More info");
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]",
          className,
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent side={side}>{children}</PopoverContent>
    </Popover>
  );
}
