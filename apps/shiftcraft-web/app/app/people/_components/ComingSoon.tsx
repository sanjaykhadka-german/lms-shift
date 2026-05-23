import type { ReactNode } from "react";

export function ComingSoon({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-lg border border-dashed border-border bg-card px-8 py-12 text-center shadow-sm">
        {icon ? (
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            {icon}
          </div>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <p className="mt-6 text-xs uppercase tracking-wider text-muted-foreground/70">
          Coming soon
        </p>
      </div>
    </div>
  );
}
