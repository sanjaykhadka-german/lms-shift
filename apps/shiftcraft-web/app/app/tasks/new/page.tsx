import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scLocations,
  users as appUsers,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { TaskForm } from "../_form";

export const metadata = { title: "Add task · ShiftCraft" };

export default async function NewTaskPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;

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
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Add task</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            New tasks land in Open by default. Set status to In progress or
            Done if you're capturing existing work.
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
          mode="create"
          assignees={assignees.map((a) => ({
            id: a.id,
            label: a.name ?? a.email,
          }))}
          locations={locations}
        />
      </section>
    </div>
  );
}
