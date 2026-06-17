import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { forTenant, scOnboardingTaskTemplates } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import {
  addOnboardingTemplateAction,
  deleteOnboardingTemplateAction,
  moveOnboardingTemplateAction,
  seedDefaultOnboardingTemplatesAction,
  updateOnboardingTemplateAction,
} from "../_actions";

export const metadata = { title: "Onboarding checklist · ShiftCraft" };
export const dynamic = "force-dynamic";

const inputCls =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

export default async function OnboardingChecklistPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app/people/onboarding");

  const { error } = await searchParams;
  const tasks = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        id: scOnboardingTaskTemplates.id,
        title: scOnboardingTaskTemplates.title,
        description: scOnboardingTaskTemplates.description,
        required: scOnboardingTaskTemplates.required,
      })
      .from(scOnboardingTaskTemplates)
      .where(eq(scOnboardingTaskTemplates.traceyTenantId, membership.tenant.id))
      .orderBy(asc(scOnboardingTaskTemplates.sortOrder)),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Onboarding checklist
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            These tasks are copied onto every new hire&rsquo;s checklist when
            you start their onboarding. If the list is empty, a built-in
            default of five tasks is used instead.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/people/onboarding">← Back to onboarding</Link>
        </Button>
      </div>

      {error === "title" ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-4 py-2 text-sm font-medium text-[var(--danger)]">
          A task needs a title.
        </div>
      ) : null}

      {/* ─── Existing tasks ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            Checklist tasks ({tasks.length})
          </h2>
        </div>
        {tasks.length === 0 ? (
          <div className="space-y-3 px-5 py-6 text-sm text-muted-foreground">
            <p>
              No custom tasks yet — new hires get the built-in default list.
              Add your own below, or start from the default five and tweak.
            </p>
            <form action={seedDefaultOnboardingTemplatesAction}>
              <Button type="submit" variant="outline" size="sm">
                Start from the default 5 tasks
              </Button>
            </form>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((t, i) => (
              <li key={t.id} className="space-y-2 px-5 py-3">
                {/* Edit form (its own <form> — siblings below are separate
                    forms, never nested). */}
                <form
                  action={updateOnboardingTemplateAction}
                  className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <input type="hidden" name="templateId" value={t.id} />
                  <input
                    name="title"
                    defaultValue={t.title}
                    required
                    maxLength={200}
                    placeholder="Task title"
                    className={inputCls}
                  />
                  <input
                    name="description"
                    defaultValue={t.description ?? ""}
                    maxLength={2000}
                    placeholder="Description (optional)"
                    className={inputCls}
                  />
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        name="required"
                        defaultChecked={t.required}
                        className="h-4 w-4 rounded border-border"
                      />
                      Required
                    </label>
                    <Button type="submit" variant="outline" size="sm">
                      Save
                    </Button>
                  </div>
                </form>
                <div className="flex items-center gap-2">
                  <MoveButton id={t.id} direction="up" disabled={i === 0} />
                  <MoveButton
                    id={t.id}
                    direction="down"
                    disabled={i === tasks.length - 1}
                  />
                  <form
                    action={deleteOnboardingTemplateAction}
                    className="ml-auto"
                  >
                    <input type="hidden" name="templateId" value={t.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Add a task ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Add a task</h2>
        </div>
        <form
          action={addOnboardingTemplateAction}
          className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_1fr_auto]"
        >
          <input
            name="title"
            required
            maxLength={200}
            placeholder="Task title"
            className={inputCls}
          />
          <input
            name="description"
            maxLength={2000}
            placeholder="Description (optional)"
            className={inputCls}
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
              <input
                type="checkbox"
                name="required"
                defaultChecked
                className="h-4 w-4 rounded border-border"
              />
              Required
            </label>
            <Button type="submit">Add</Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function MoveButton({
  id,
  direction,
  disabled,
}: {
  id: string;
  direction: "up" | "down";
  disabled: boolean;
}) {
  return (
    <form action={moveOnboardingTemplateAction}>
      <input type="hidden" name="templateId" value={id} />
      <input type="hidden" name="direction" value={direction} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-label={direction === "up" ? "Move up" : "Move down"}
      >
        {direction === "up" ? "↑" : "↓"}
      </Button>
    </form>
  );
}
