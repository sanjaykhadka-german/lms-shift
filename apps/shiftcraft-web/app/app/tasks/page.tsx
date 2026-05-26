import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scLocations,
  scTasks,
  users as appUsers,
  type ScTaskPriority,
  type ScTaskStatus,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { TaskBoard, type BoardTask } from "./_board";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Tasks · ShiftCraft" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const { added } = await searchParams;
  const tenantId = membership.tenant.id;

  const tasks = await forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scTasks)
      .where(eq(scTasks.traceyTenantId, tenantId))
      .orderBy(asc(scTasks.dueDate), asc(scTasks.createdAt)),
  );

  const assigneeIds = Array.from(
    new Set(tasks.map((t) => t.assigneeUserId).filter((v): v is string => !!v)),
  );
  const locationIds = Array.from(
    new Set(tasks.map((t) => t.locationId).filter((v): v is string => !!v)),
  );

  const assignees = assigneeIds.length
    ? await db
        .select({
          id: appUsers.id,
          name: appUsers.name,
          email: appUsers.email,
        })
        .from(appUsers)
        .innerJoin(members, eq(members.userId, appUsers.id))
        .where(eq(members.tenantId, tenantId))
    : [];
  const assigneeById = new Map(
    assignees.map((a) => [a.id, a.name ?? a.email]),
  );

  const locations = locationIds.length
    ? await forTenant(tenantId).run((tx) =>
        tx
          .select({ id: scLocations.id, name: scLocations.name })
          .from(scLocations)
          .where(eq(scLocations.traceyTenantId, tenantId)),
      )
    : [];
  const locationNameById = new Map(locations.map((l) => [l.id, l.name]));

  const boardTasks: BoardTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status as ScTaskStatus,
    priority: t.priority as ScTaskPriority,
    dueDate: t.dueDate,
    assigneeUserId: t.assigneeUserId,
    assigneeName: t.assigneeUserId
      ? (assigneeById.get(t.assigneeUserId) ?? null)
      : null,
    locationName: t.locationId
      ? (locationNameById.get(t.locationId) ?? null)
      : null,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
            Tasks
            <InfoPopover label="About tasks">
              <p>
                Tenant-wide kanban board. Drag a card between{" "}
                <strong>Open</strong>, <strong>In progress</strong>, and{" "}
                <strong>Done</strong> to update status; due dates surface
                on the dashboard.
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tasks.length} task{tasks.length === 1 ? "" : "s"} on the board
            for {membership.tenant.name}. Drag cards between columns or use
            keyboard (Space to pick up, ← / → / ↑ / ↓ to move, Space to drop).
          </p>
        </div>
        <Button asChild>
          <Link href="/app/tasks/new">Add task</Link>
        </Button>
      </div>

      {added === "1" && (
        <div className="rounded-md border-2 border-emerald-500/60 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-950/50 dark:text-emerald-100">
          Task added.
        </div>
      )}

      <TaskBoard initialTasks={boardTasks} />
    </div>
  );
}
