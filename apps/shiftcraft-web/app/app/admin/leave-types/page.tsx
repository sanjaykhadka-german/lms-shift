import { redirect } from "next/navigation";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { listAllLeaveTypes } from "~/lib/leave-types";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";
import { CreateLeaveTypeForm } from "./_create-form";
import { RenameLeaveTypeForm } from "./_rename-form";
import {
  toggleArchiveAction,
  deleteLeaveTypeAction,
  setAccrualRateAction,
} from "./actions";

export const metadata = { title: "Leave types · ShiftCraft" };
export const dynamic = "force-dynamic";

// Slugs of the seeded defaults — these get a "Seeded" pill and lose the
// Delete action (admins can archive instead). Mirrors ScSeededLeaveSlug
// from the schema package but kept inline here so the page doesn't pull
// the type just to read names.
const SEEDED_SLUGS = new Set([
  "annual",
  "personal_sick",
  "unpaid",
  "long_service",
  "other",
]);

export default async function LeaveTypesAdminPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");

  const rows = await listAllLeaveTypes(membership.tenant.id);
  const active = rows.filter((r) => !r.isArchived);
  const archived = rows.filter((r) => r.isArchived);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Leave types
          <InfoPopover label="About leave types">
            <p>
              Per-tenant catalogue the time-off request form uses. Five
              AU-standard types (Annual, Personal/Sick, Unpaid, Long
              service, Other) seed on first run.
            </p>
            <p className="mt-1">
              Renaming is safe — the underlying{" "}
              <strong>slug</strong> stays stable so existing requests
              keep their categorisation. Archive (don&rsquo;t delete) once
              any request references one.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Categories that staff pick when submitting a time-off request.
          Renaming keeps existing requests intact. Archiving hides a type
          from the request form without losing history; delete is only
          allowed when a type has never been used.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Add a custom type</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          The name appears on the request form and on the listing page.
        </p>
        <CreateLeaveTypeForm />
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">
            Active ({active.length})
          </h2>
        </div>
        {active.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No active leave types.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {active.map((lt) => {
              const isSeeded = SEEDED_SLUGS.has(lt.slug);
              return (
                <li
                  key={lt.id}
                  className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1">
                    <RenameLeaveTypeForm id={lt.id} currentName={lt.name} />
                    <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span className="font-mono">{lt.slug}</span>
                      {isSeeded && (
                        <span className="rounded-full bg-[var(--accent-deep)] px-2 py-0.5 font-semibold text-[var(--accent-ink)]">
                          Seeded
                        </span>
                      )}
                    </div>
                  </div>
                  <form
                    action={setAccrualRateAction}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="id" value={lt.id} />
                    <label
                      htmlFor={`rate-${lt.id}`}
                      className="text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      Accrual / h
                    </label>
                    <input
                      id={`rate-${lt.id}`}
                      name="rate"
                      type="number"
                      step="0.000001"
                      min="0"
                      max="1"
                      defaultValue={
                        lt.accrualRatePerHour
                          ? Number(lt.accrualRatePerHour).toFixed(6)
                          : ""
                      }
                      placeholder="0"
                      className="h-8 w-28 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-right font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                    />
                    <Button type="submit" size="sm" variant="outline">
                      Save
                    </Button>
                  </form>
                  <div className="flex items-center gap-2">
                    <form action={toggleArchiveAction}>
                      <input type="hidden" name="id" value={lt.id} />
                      <input type="hidden" name="archive" value="1" />
                      <Button type="submit" size="sm" variant="outline">
                        Archive
                      </Button>
                    </form>
                  </div>
                </li>
              );
            })}
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
              Hidden from the request form. Unarchive to re-enable, or
              delete if it&apos;s never been used.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {archived.map((lt) => {
              const isSeeded = SEEDED_SLUGS.has(lt.slug);
              return (
                <li
                  key={lt.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <div className="text-sm font-medium line-through opacity-70">
                      {lt.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {lt.slug}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={toggleArchiveAction}>
                      <input type="hidden" name="id" value={lt.id} />
                      <input type="hidden" name="archive" value="0" />
                      <Button type="submit" size="sm" variant="outline">
                        Unarchive
                      </Button>
                    </form>
                    {!isSeeded && (
                      <form action={deleteLeaveTypeAction}>
                        <input type="hidden" name="id" value={lt.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          className="border-destructive/40 text-destructive hover:bg-destructive/10"
                        >
                          Delete
                        </Button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
