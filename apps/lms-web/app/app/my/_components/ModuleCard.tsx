import Link from "next/link";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatDate } from "~/lib/format/datetime";

export type ModuleStatus = "completed" | "overdue" | "due_soon" | "open";

interface ModuleCardProps {
  moduleId: number;
  title: string;
  description: string | null | undefined;
  status: ModuleStatus;
  attempts: number;
  bestScore: number | null;
  lastAttemptAt: Date | null;
  dueAt: Date | null;
  timezone: string;
}

export function ModuleCard(props: ModuleCardProps) {
  const cta = props.status === "completed" ? "Review" : props.attempts > 0 ? "Resume" : "Open";
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
      <StatusBadge status={props.status} />
      <h3 className="text-lg font-semibold tracking-tight">{props.title}</h3>
      {props.description && (
        <p className="flex-1 text-sm text-[color:var(--muted-foreground)] line-clamp-3 whitespace-pre-line">
          {props.description}
        </p>
      )}
      <div className="text-xs text-[color:var(--muted-foreground)]">
        {props.attempts > 0 ? (
          <>
            Best <strong className="text-[color:var(--foreground)]">{props.bestScore ?? 0}%</strong>
            {" · "}
            {props.attempts} attempt{props.attempts === 1 ? "" : "s"}
            {props.lastAttemptAt && (
              <>
                {" · "}Last {formatDate(props.lastAttemptAt, props.timezone, { month: "short", day: "numeric" })}
              </>
            )}
          </>
        ) : (
          <>No attempts yet</>
        )}
        {props.dueAt && <> · Due {formatDate(props.dueAt, props.timezone, { month: "short", day: "numeric" })}</>}
      </div>
      <div>
        <Button asChild>
          <Link href={`/app/my/modules/${props.moduleId}`}>{cta}</Link>
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ModuleStatus }) {
  if (status === "completed") return <Badge variant="success">Completed</Badge>;
  if (status === "overdue") return <Badge variant="destructive">Overdue</Badge>;
  if (status === "due_soon") return <Badge variant="warning">Due soon</Badge>;
  return <Badge variant="outline">Outstanding</Badge>;
}
