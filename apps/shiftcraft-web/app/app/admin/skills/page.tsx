import { redirect } from "next/navigation";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { listAllSkills } from "~/lib/skills";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";
import { CreateSkillForm } from "./_create-form";
import { RenameSkillForm } from "./_rename-form";
import { deleteSkillAction, toggleArchiveAction } from "./actions";

export const metadata = { title: "Skills · ShiftCraft" };
export const dynamic = "force-dynamic";

export default async function SkillsAdminPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");

  const rows = await listAllSkills(membership.tenant.id);
  const active = rows.filter((r) => !r.isArchived);
  const archived = rows.filter((r) => r.isArchived);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
          Skills
          <InfoPopover label="About skills">
            <p>
              Tags on employees + shifts so the auto-scheduler matches
              qualified people to qualified shifts. Each shift can
              require one skill; only employees with that skill in
              their kit are candidates.
            </p>
            <p className="mt-1">
              Archive (don&rsquo;t delete) once any shift or employee
              references one — delete only when the skill has never
              been used.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tagged on employees + shifts so the auto-scheduler can match
          qualified people to qualified shifts. Renaming keeps existing
          tags intact. Archive hides a skill from new shift forms without
          losing history; delete is only allowed when no employee or
          shift references it.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Add a skill</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Pick a name workers + managers will recognise at a glance.
        </p>
        <CreateSkillForm />
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Active ({active.length})</h2>
        </div>
        {active.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No active skills yet. Add one above to start tagging.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {active.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex-1">
                  <RenameSkillForm id={s.id} currentName={s.name} />
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.slug}
                  </div>
                </div>
                <form action={toggleArchiveAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="archive" value="1" />
                  <Button type="submit" size="sm" variant="outline">
                    Archive
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section className="rounded-lg border border-border bg-muted/30 shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">
              Archived ({archived.length})
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Hidden from new shift forms. Unarchive to re-enable, or
              delete if no employee or shift references it.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {archived.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div>
                  <div className="text-sm font-medium line-through opacity-70">
                    {s.name}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.slug}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <form action={toggleArchiveAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="archive" value="0" />
                    <Button type="submit" size="sm" variant="outline">
                      Unarchive
                    </Button>
                  </form>
                  <form action={deleteSkillAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
