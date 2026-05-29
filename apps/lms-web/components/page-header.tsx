import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, badge, actions }: PageHeaderProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[color:var(--border)] bg-gradient-to-br from-[color:var(--primary)]/8 via-[color:var(--card)] to-[color:var(--accent)]/8 p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[color:var(--primary)]/10 blur-3xl"
      />
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div>
          {badge && <div>{badge}</div>}
          <h1 className={`flex flex-wrap items-center gap-1.5 text-3xl font-semibold tracking-tight ${badge ? "mt-3" : ""}`}>
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
