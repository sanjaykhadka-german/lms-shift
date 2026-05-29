"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./input";
import { cn } from "~/lib/utils";

type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
>;

/**
 * Input with a built-in show/hide toggle. Drop-in replacement for
 * <Input type="password">. The toggle button is keyboard-accessible
 * and announces its state via aria-pressed.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-10", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)] rounded-r-md"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
