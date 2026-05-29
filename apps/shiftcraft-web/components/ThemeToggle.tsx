"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Toggles the `.dark` class on <html> and persists the choice to
 * localStorage under `sc-theme`. The initial class is applied pre-paint by
 * the bootstrap script in app/layout.tsx, so this only reflects/flips state.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("sc-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-[var(--r-sm)] border border-line text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink",
        className,
      )}
    >
      {/* Avoid a hydration mismatch: render a stable icon until mounted. */}
      {mounted && dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
