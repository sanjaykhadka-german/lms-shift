import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scDepartments,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShiftComments,
  scShifts,
  users,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { checkAvailability } from "~/lib/availability-check";
import { findConflictedUserIds } from "~/lib/shift-conflicts";
import {
  getManagedLocationIds,
  isLocationInScope,
} from "~/lib/manager-scope";
import { listActiveSkills } from "~/lib/skills";
import { Button } from "~/components/ui/button";
import { ShiftForm } from "./_form";
import {
  bulkOfferShiftAction,
  cancelShiftAction,
  copyShiftToDateAction,
  duplicateShiftAction,
  publishShiftAction,
  unassignAction,
} from "./actions";
import { DeleteShiftButton } from "./_delete-shift-button";
import { AssignForm } from "./_assign-form";
import { SaveTemplateForm } from "./_save-template-form";
import { ShiftComments, type ShiftComment } from "./_comments";
import { deleteShiftCommentAction } from "./comment-actions";

// Convert a Date to YYYY-MM-DDTHH:mm in the user's local tz (what
// <input type="datetime-local"> expects).
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Date-only (YYYY-MM-DD) in the same local frame toLocalInput uses — what
// <input type="date"> expects and the frame copyShiftToDateAction reads back.
function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const ASSIGN_BADGE: Record<string, string> = {
  offered: "bg-[var(--warn)] text-white",
  accepted: "bg-[var(--live)] text-white",
  declined: "bg-[var(--danger)] text-white",
  swapped: "bg-[var(--accent-deep)] text-[var(--accent-ink)]",
  no_show: "bg-[var(--danger)] text-white",
};

// Full shift editor. Rendered by both the standalone /app/schedule/[id]/edit
// page and the intercepting @modal route, so it owns all data fetching and
// must not assume a particular page chrome — the caller provides the wrapper
// (full page padding vs. dialog shell).
export async function EditShiftContent({
  id,
  offered: offeredRaw,
  skipped: skippedRaw,
  leave: leaveRaw,
}: {
  id: string;
  offered?: string;
  skipped?: string;
  leave?: string;
}) {
  const offeredCount = Number.parseInt(offeredRaw ?? "", 10);
  const skippedCount = Number.parseInt(skippedRaw ?? "", 10);
  const leaveSkippedCount = Number.parseInt(leaveRaw ?? "", 10);
  const showOfferFlash =
    Number.isFinite(offeredCount) && offeredRaw !== undefined;
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const me = await currentUser();
  if (!me) redirect("/sign-in");

  const isAdmin = isAtLeastManager(membership.role);

  const ctx = forTenant(membership.tenant.id);
  const [shiftRow] = await ctx.run((tx) =>
    tx
      .select({
        id: scShifts.id,
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        status: scShifts.status,
        notes: scShifts.notes,
        breaks: scShifts.breaks,
        requiredSkillId: scShifts.requiredSkillId,
      })
      .from(scShifts)
      .where(
        and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, membership.tenant.id)),
      )
      .limit(1),
  );

  if (!shiftRow) notFound();

  // AUDIT.md #13 — scoped managers can't view a shift outside their
  // location set. Returning notFound rather than 403 mirrors how
  // tenant-isolation hides cross-tenant rows.
  const scope = await getManagedLocationIds(
    membership.tenant.id,
    me.id,
    membership.role,
  );
  if (!isLocationInScope(scope, shiftRow.locationId)) notFound();

  const [locations, assignments, tenantMembers, departments, commentRows] =
    await Promise.all([
      ctx.run((tx) =>
        tx
          .select({ id: scLocations.id, name: scLocations.name })
          .from(scLocations)
          .orderBy(asc(scLocations.name)),
      ),
      ctx.run((tx) =>
        tx
          .select({
            id: scShiftAssignments.id,
            userId: scShiftAssignments.userId,
            status: scShiftAssignments.status,
            respondedAt: scShiftAssignments.respondedAt,
            createdAt: scShiftAssignments.createdAt,
            userName: users.name,
            userEmail: users.email,
          })
          .from(scShiftAssignments)
          .leftJoin(users, eq(users.id, scShiftAssignments.userId))
          .where(eq(scShiftAssignments.shiftId, id))
          .orderBy(asc(scShiftAssignments.createdAt)),
      ),
      db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.tenantId, membership.tenant.id))
        .orderBy(asc(users.name), asc(users.email)),
      ctx.run((tx) =>
        tx
          .select({ id: scDepartments.id, name: scDepartments.name })
          .from(scDepartments)
          .where(eq(scDepartments.traceyTenantId, membership.tenant.id))
          .orderBy(asc(scDepartments.name)),
      ),
      ctx.run((tx) =>
        tx
          .select({
            id: scShiftComments.id,
            body: scShiftComments.body,
            createdAt: scShiftComments.createdAt,
            authorUserId: scShiftComments.authorUserId,
            authorName: users.name,
            authorEmail: users.email,
            authorImage: users.image,
          })
          .from(scShiftComments)
          .leftJoin(users, eq(users.id, scShiftComments.authorUserId))
          .where(eq(scShiftComments.shiftId, id))
          .orderBy(asc(scShiftComments.createdAt)),
      ),
    ]);

  const comments: ShiftComment[] = commentRows.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    authorUserId: c.authorUserId,
    authorName: c.authorName,
    authorEmail: c.authorEmail,
    authorImage: c.authorImage,
  }));

  const assignedIds = new Set(assignments.map((a) => a.userId));
  const availableEmployees = tenantMembers.filter((m) => !assignedIds.has(m.id));

  // Conflict guard: which of the currently-assigned users already have an
  // accepted shift overlapping this one? (We pass the current shift's ID
  // as `excludeShiftId` so an "accepted" row on THIS shift doesn't
  // self-conflict.)
  const conflictedUserIds = await findConflictedUserIds(
    membership.tenant.id,
    assignments.map((a) => a.userId),
    shiftRow.startsAt,
    shiftRow.endsAt,
    shiftRow.id,
  );

  // Availability check: pull each assigned user's declared free-text
  // availability and run the parser to see whether the shift falls
  // inside it. Only confident mismatches surface a chip; "unknown"
  // (blank or unparseable) stays silent.
  const assignedEmployeeRows =
    assignments.length === 0
      ? []
      : await ctx.run((tx) =>
          tx
            .select({
              appUserId: scEmployees.appUserId,
              availability: scEmployees.availability,
            })
            .from(scEmployees)
            .where(eq(scEmployees.traceyTenantId, membership.tenant.id)),
        );
  const availabilityByUser = new Map<string, Record<string, string> | null>();
  for (const r of assignedEmployeeRows) {
    if (r.appUserId) {
      availabilityByUser.set(
        r.appUserId,
        (r.availability as Record<string, string> | null) ?? null,
      );
    }
  }
  const availabilityVerdictByAssignment = new Map<
    string,
    { kind: "mismatch"; reason: string } | null
  >();
  for (const a of assignments) {
    const verdict = checkAvailability(
      availabilityByUser.get(a.userId) ?? null,
      shiftRow.startsAt,
      shiftRow.endsAt,
    );
    availabilityVerdictByAssignment.set(
      a.id,
      verdict.kind === "mismatch" ? verdict : null,
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">
          Edit shift
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Status: <span className="font-medium capitalize">{shiftRow.status}</span>
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <ShiftForm
          mode="edit"
          shiftId={shiftRow.id}
          startLocked={shiftRow.startsAt.getTime() <= Date.now()}
          locations={locations}
          skills={await listActiveSkills(membership.tenant.id)}
          defaultValues={{
            locationId: shiftRow.locationId,
            role: shiftRow.role,
            startsAt: toLocalInput(shiftRow.startsAt),
            endsAt: toLocalInput(shiftRow.endsAt),
            notes: shiftRow.notes,
            breaks: shiftRow.breaks,
            requiredSkillId: shiftRow.requiredSkillId,
          }}
        />
      </section>

      {showOfferFlash && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          {offeredCount > 0
            ? `Offered to ${offeredCount} ${offeredCount === 1 ? "person" : "people"}.`
            : "No new offers — every candidate already had an assignment."}
          {skippedCount > 0 &&
            ` Skipped ${skippedCount} who already had one.`}
          {Number.isFinite(leaveSkippedCount) && leaveSkippedCount > 0 && (
            <span>
              {" "}Skipped {leaveSkippedCount} on approved leave.
            </span>
          )}
        </div>
      )}

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">
          Assignments ({assignments.length})
        </h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Directly scheduled employees are confirmed straight away. "Offer to
          all" (below) sends offers that employees accept or decline from their
          own shifts page.
        </p>

        {assignments.length === 0 ? (
          <p className="mb-4 text-sm text-muted-foreground">
            No one is assigned yet.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-border">
            {assignments.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {a.userName ?? a.userEmail ?? "Unknown"}
                  </div>
                  {a.respondedAt && (
                    <div className="text-xs text-muted-foreground">
                      Responded {a.respondedAt.toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {conflictedUserIds.has(a.userId) && (
                    <span
                      title="This person already has another accepted shift overlapping this time."
                      className="inline-flex items-center rounded-full bg-[var(--danger)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white"
                    >
                      Conflict
                    </span>
                  )}
                  {availabilityVerdictByAssignment.get(a.id) && (
                    <span
                      title={availabilityVerdictByAssignment.get(a.id)!.reason}
                      className="inline-flex items-center rounded-full bg-[var(--warn)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white"
                    >
                      Outside avail
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ASSIGN_BADGE[a.status] ?? ""}`}
                  >
                    {a.status.replace("_", " ")}
                  </span>
                  {isAdmin && (
                    <form action={unassignAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="shiftId" value={shiftRow.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                      >
                        Unassign
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {isAdmin && (
          <AssignForm
            shiftId={shiftRow.id}
            availableEmployees={availableEmployees}
          />
        )}

        {isAdmin && (
          <form
            action={bulkOfferShiftAction}
            className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3"
          >
            <input type="hidden" name="shiftId" value={shiftRow.id} />
            <div className="flex-1 min-w-[180px] space-y-1">
              <label
                htmlFor="bulk-dept"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Bulk offer
              </label>
              <select
                id="bulk-dept"
                name="departmentId"
                defaultValue=""
                className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
              >
                <option value="">Everyone in {membership.tenant.name}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="outline" size="sm">
              Offer to all
            </Button>
            <p className="w-full text-[11px] text-muted-foreground">
              Sends an offer to every linked employee in the chosen scope.
              Skips anyone already on this shift. Email opt-outs are
              respected.
            </p>
          </form>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">Comments</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Visible to everyone in {membership.tenant.name}. Anyone can post;
          authors and admins can delete.
        </p>
        <ShiftComments
          shiftId={shiftRow.id}
          currentUserId={me.id}
          isAdmin={isAdmin}
          comments={comments}
          onDelete={deleteShiftCommentAction}
        />
      </section>

      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-5 shadow-sm">
        {shiftRow.status !== "published" && (
          <form action={publishShiftAction}>
            <input type="hidden" name="id" value={shiftRow.id} />
            <Button type="submit" variant="outline" size="sm">
              Publish
            </Button>
          </form>
        )}
        {shiftRow.status !== "cancelled" && (
          <form action={cancelShiftAction}>
            <input type="hidden" name="id" value={shiftRow.id} />
            <Button type="submit" variant="outline" size="sm">
              Cancel shift
            </Button>
          </form>
        )}
        <form action={duplicateShiftAction}>
          <input type="hidden" name="id" value={shiftRow.id} />
          <input type="hidden" name="weeks" value="1" />
          <Button type="submit" variant="outline" size="sm">
            Duplicate +1 week
          </Button>
        </form>
        <form action={copyShiftToDateAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={shiftRow.id} />
          <label className="sr-only" htmlFor="copy-to-date">
            Copy to date
          </label>
          <input
            id="copy-to-date"
            type="date"
            name="targetDate"
            defaultValue={toDateInput(
              new Date(shiftRow.startsAt.getTime() + 86_400_000),
            )}
            className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          />
          <Button type="submit" variant="outline" size="sm">
            Copy to date
          </Button>
        </form>
        {isAdmin && <SaveTemplateForm shiftId={shiftRow.id} />}
        <DeleteShiftButton shiftId={shiftRow.id} />
      </section>
    </div>
  );
}
