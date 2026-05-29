import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scLocations,
  scTasks,
  users as appUsers,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { TaskForm } from "../../_form";
import { deleteTaskAction } from "../../actions";

export const metadata = { title: "Edit task · ShiftCraft" };

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;

  const [taskRow] = await forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scTasks)
      .where(
        and(eq(scTasks.id, id), eq(scTasks.traceyTenantId, tenantId)),
      )
      .limit(1),
  );
  if (!taskRow) notFound();

  const [assignees, locations] = await Promise.all([
    db
      .select({
        id: appUsers.id,
        name: appUsers.name,
        email: appUsers.email,
      })
      .from(appUsers)
      .innerJoin(members, eq(members.userId, appUsers.id))
      .where(eq(members.tenantId, tenantId))
      .orderBy(asc(appUsers.name), asc(appUsers.email)),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name })
        .from(scLocations)
        .where(eq(scLocations.traceyTenantId, tenantId))
        .orderBy(asc(scLocations.name)),
    ),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Edit task</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Created{" "}
            {taskRow.createdAt.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {taskRow.completedAt &&
              ` · completed ${taskRow.completedAt.toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              })}`}
          </p>
        </div>
        <Link
          href="/app/tasks"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to board
        </Link>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <TaskForm
          mode="edit"
          taskId={taskRow.id}
          defaultValues={{
            title: taskRow.title,
            description: taskRow.description,
            status: taskRow.status,
            priority: taskRow.priority,
            assigneeUserId: taskRow.assigneeUserId,
            locationId: taskRow.locationId,
            dueDate: taskRow.dueDate,
          }}
          assignees={assignees.map((a) => ({
            id: a.id,
            label: a.name ?? a.email,
          }))}
          locations={locations}
        />
      </section>

      <section className="rounded-lg border border-[color:var(--destructive)]/30 bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[color:var(--destructive)]">
          Delete task
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Removes the task from the board. Cannot be undone.
        </p>
        <form action={deleteTaskAction} className="mt-3">
          <input type="hidden" name="id" value={taskRow.id} />
          <Button
            type="submit"
            variant="outline"
            className="text-[color:var(--destructive)] border-[color:var(--destructive)]/40 hover:bg-[color:var(--destructive)]/10"
          >
            Delete
          </Button>
        </form>
      </section>
    </div>
  );
}
