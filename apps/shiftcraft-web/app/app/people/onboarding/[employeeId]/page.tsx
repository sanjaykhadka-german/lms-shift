import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import {
  forTenant,
  scDepartments,
  scEmployees,
  scEmployeeOnboardingTasks,
  type ScOnboardingStatus,
  type ScOnboardingTaskStatus,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";
import {
  completeOnboardingAction,
  markOnboardingTaskAction,
} from "../_actions";

export const metadata = { title: "Onboarding checklist · ShiftCraft" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<ScOnboardingStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  active: "Onboarded",
};

const STATUS_BADGE: Record<ScOnboardingStatus, string> = {
  pending: "bg-amber-500 text-white",
  in_progress: "bg-blue-600 text-white",
  active: "bg-emerald-600 text-white",
};

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function OnboardingChecklistPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;
  const canManage = isAtLeastManager(membership.role);

  const { employeeId } = await params;

  const [employee, tasks] = await forTenant(tenantId).run(async (tx) => {
    const [emp] = await tx
      .select({
        id: scEmployees.id,
        fullName: scEmployees.fullName,
        email: scEmployees.email,
        mobile: scEmployees.mobile,
        department: scDepartments.name,
        status: scEmployees.onboardingStatus,
        startedAt: scEmployees.onboardingStartedAt,
        completedAt: scEmployees.onboardingCompletedAt,
      })
      .from(scEmployees)
      .leftJoin(
        scDepartments,
        eq(scDepartments.id, scEmployees.departmentId),
      )
      .where(eq(scEmployees.id, employeeId))
      .limit(1);

    const taskRows = await tx
      .select({
        id: scEmployeeOnboardingTasks.id,
        title: scEmployeeOnboardingTasks.title,
        description: scEmployeeOnboardingTasks.description,
        required: scEmployeeOnboardingTasks.required,
        status: scEmployeeOnboardingTasks.status,
        completedAt: scEmployeeOnboardingTasks.completedAt,
      })
      .from(scEmployeeOnboardingTasks)
      .where(eq(scEmployeeOnboardingTasks.employeeId, employeeId))
      .orderBy(
        asc(scEmployeeOnboardingTasks.sortOrder),
        asc(scEmployeeOnboardingTasks.title),
      );

    return [emp, taskRows];
  });

  if (!employee) notFound();

  const status = employee.status as ScOnboardingStatus;
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const requiredPending = tasks.some(
    (t) => t.required && t.status === "pending",
  );
  const canComplete = canManage && !requiredPending && status !== "active";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      {/* ─── Breadcrumb ─── */}
      <div className="text-xs text-muted-foreground">
        <Link
          href="/app/people/onboarding"
          className="hover:underline"
        >
          ← Back to onboarding
        </Link>
      </div>

      {/* ─── Employee card ─── */}
      <section className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        <Avatar
          name={employee.fullName}
          email={employee.email ?? employee.fullName}
          image={null}
          sizeClass="h-14 w-14"
          textClass="text-base"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {employee.fullName}
          </h1>
          <div className="text-sm text-muted-foreground">
            {employee.email ?? "No email"}
            {employee.department ? ` · ${employee.department}` : ""}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE[status]}`}
            >
              {STATUS_LABEL[status]}
            </span>
            <span>·</span>
            <span>
              Started {fmtDate(employee.startedAt)}
              {employee.completedAt
                ? ` · Completed ${fmtDate(employee.completedAt)}`
                : ""}
            </span>
          </div>
        </div>
        <div className="text-right text-xs tabular-nums text-muted-foreground">
          <div className="text-lg font-semibold text-foreground">
            {doneTasks}/{totalTasks}
          </div>
          <div>tasks done</div>
        </div>
      </section>

      {/* ─── Checklist ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Checklist</h2>
        </div>
        {tasks.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No tasks for this employee. They may have been onboarded before
            checklists existed.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((t) => {
              const isDone =
                (t.status as ScOnboardingTaskStatus) === "done";
              return (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm font-medium ${isDone ? "text-muted-foreground line-through" : ""}`}
                      >
                        {t.title}
                      </span>
                      {!t.required ? (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Optional
                        </span>
                      ) : null}
                      {isDone && t.completedAt ? (
                        <span className="text-[10px] text-muted-foreground">
                          ✓ {fmtDate(t.completedAt)}
                        </span>
                      ) : null}
                    </div>
                    {t.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.description}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <form
                      action={markOnboardingTaskAction}
                      className="flex-shrink-0"
                    >
                      <input type="hidden" name="taskId" value={t.id} />
                      <input
                        type="hidden"
                        name="done"
                        value={isDone ? "false" : "true"}
                      />
                      <Button
                        type="submit"
                        variant={isDone ? "ghost" : "outline"}
                        size="sm"
                      >
                        {isDone ? "Reopen" : "Mark done"}
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ─── Complete (admin only) ─── */}
      {canManage && status !== "active" ? (
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold">Complete onboarding</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {requiredPending
              ? "Finish all required tasks above to enable completion."
              : "Mark this employee as fully onboarded. They'll disappear from the queue."}
          </p>
          <form action={completeOnboardingAction} className="mt-3">
            <input type="hidden" name="employeeId" value={employee.id} />
            <Button type="submit" disabled={!canComplete}>
              Complete onboarding
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
