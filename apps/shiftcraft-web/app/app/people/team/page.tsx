import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import {
  auditEvents,
  db,
  forTenant,
  invitations,
  members,
  scDepartments,
  scDocuments,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShifts,
  users,
  type ScEmploymentType,
  type ScOnboardingStatus,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager, friendlyRoleLabel } from "~/lib/roles";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";
import { InviteForm } from "../_components/InviteForm";
import { RevokeInvitationButton } from "../_components/RevokeInvitationButton";
import { revokeInvitationAction } from "../_actions";
import { EmployeeNameButton } from "../_components/EmployeeNameButton";
import type { EmployeeDetail } from "../_components/EmployeeDetailModal";

export const metadata = { title: "Team members · ShiftCraft" };
export const dynamic = "force-dynamic";

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-indigo-600 text-white",
  admin: "bg-blue-600 text-white",
  member: "bg-slate-500 text-white",
};

const EMPLOYMENT_BADGE: Record<ScEmploymentType, string> = {
  permanent: "bg-emerald-600 text-white",
  casual: "bg-amber-500 text-white",
  labour_hire: "bg-purple-600 text-white",
};

const EMPLOYMENT_LABEL: Record<ScEmploymentType, string> = {
  permanent: "Permanent",
  casual: "Casual",
  labour_hire: "Labour hire",
};

function actionTone(action: string): string {
  if (action.endsWith(".deleted") || action.endsWith(".revoked")) {
    return "bg-red-600 text-white";
  }
  if (action.endsWith(".approved")) return "bg-emerald-600 text-white";
  if (action.endsWith(".disputed")) return "bg-amber-500 text-white";
  if (
    action.endsWith(".created") ||
    action.endsWith(".added") ||
    action.endsWith(".invited") ||
    action.endsWith(".paired") ||
    action.endsWith(".restored")
  ) {
    return "bg-blue-600 text-white";
  }
  return "bg-slate-500 text-white";
}

function fmtWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtJoined(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatRate(rate: string | null): string | null {
  if (!rate) return null;
  const n = Number(rate);
  if (Number.isNaN(n)) return null;
  return `$${n.toFixed(2)}`;
}

function buildEmployeeDetail(
  sc: {
    id: string;
    fullName: string;
    email: string | null;
    mobile: string | null;
    department: string | null;
    employmentType: string;
    appUserId: string | null;
    isActive: boolean;
    hourlyRate: string | null;
    onboardingStatus: string;
    onboardingStartedAt: Date | null;
    onboardingCompletedAt: Date | null;
    createdAt: Date;
    notes: string | null;
    availability: unknown;
    preferredName: string | null;
    gender: string | null;
    dateOfBirth: string | null;
    addressLine: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  },
  authRole: string | null,
  docs: Array<{
    id: string;
    title: string;
    mimeType: string;
    fileSize: number;
    uploadedAt: Date;
    expiresAt: Date | null;
  }>,
  shifts: Array<{
    startsAt: Date;
    endsAt: Date;
    locationName: string | null;
    status: string;
  }>,
): EmployeeDetail {
  return {
    id: sc.id,
    fullName: sc.fullName,
    preferredName: sc.preferredName,
    email: sc.email,
    mobile: sc.mobile,
    gender: sc.gender,
    dateOfBirthIso: sc.dateOfBirth,
    addressLine: sc.addressLine,
    emergencyContactName: sc.emergencyContactName,
    emergencyContactPhone: sc.emergencyContactPhone,
    departmentName: sc.department,
    employmentType: sc.employmentType,
    hourlyRate: sc.hourlyRate,
    hireDateIso: sc.createdAt.toISOString(),
    notes: sc.notes,
    isActive: sc.isActive,
    onboardingStatus: sc.onboardingStatus as
      | "pending"
      | "in_progress"
      | "active",
    onboardingStartedAtIso: sc.onboardingStartedAt?.toISOString() ?? null,
    onboardingCompletedAtIso: sc.onboardingCompletedAt?.toISOString() ?? null,
    availability:
      (sc.availability as Record<string, string> | null) ?? null,
    documents: docs.map((d) => ({
      id: d.id,
      title: d.title,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      uploadedAtIso: d.uploadedAt.toISOString(),
      expiresAtIso: d.expiresAt?.toISOString() ?? null,
    })),
    shifts: shifts.map((s) => ({
      startsAtIso: s.startsAt.toISOString(),
      endsAtIso: s.endsAt.toISOString(),
      locationName: s.locationName,
      status: s.status,
    })),
    appUserId: sc.appUserId,
    authRole,
  };
}

function OnboardingPill({
  status,
  employeeId,
}: {
  status: ScOnboardingStatus | null | undefined;
  employeeId: string | null;
}) {
  if (!status || status === "active" || !employeeId) return null;
  const tone =
    status === "pending"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "bg-blue-500/15 text-blue-700 dark:text-blue-300";
  const label =
    status === "pending" ? "Onboarding pending" : "Onboarding in progress";
  return (
    <Link
      href={`/app/people/onboarding/${employeeId}`}
      className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tone} hover:underline`}
    >
      {label} →
    </Link>
  );
}

type SearchParams = {
  q?: string;
  added?: string;
};

export default async function PeopleTeamPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;
  const canManage = isAtLeastManager(membership.role);

  const { q: rawQ, added } = await searchParams;
  const q = (rawQ ?? "").trim().toLowerCase();

  // Auth-side roster — Tracey users with a membership in this tenant.
  const memberRoster = await db
    .select({
      memberId: members.id,
      role: members.role,
      joinedAt: members.createdAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.tenantId, tenantId))
    .orderBy(asc(users.name), asc(users.email));

  // ShiftCraft-side HR roster (includes labour-hire / no-auth rows). The
  // SELECT pulls every column the People > Team detail modal renders so
  // the modal can open without a follow-up round-trip.
  const scRoster = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        fullName: scEmployees.fullName,
        email: scEmployees.email,
        mobile: scEmployees.mobile,
        department: scDepartments.name,
        employmentType: scEmployees.employmentType,
        appUserId: scEmployees.appUserId,
        isActive: scEmployees.isActive,
        hourlyRate: scEmployees.hourlyRate,
        onboardingStatus: scEmployees.onboardingStatus,
        onboardingStartedAt: scEmployees.onboardingStartedAt,
        onboardingCompletedAt: scEmployees.onboardingCompletedAt,
        createdAt: scEmployees.createdAt,
        notes: scEmployees.notes,
        availability: scEmployees.availability,
        preferredName: scEmployees.preferredName,
        gender: scEmployees.gender,
        dateOfBirth: scEmployees.dateOfBirth,
        addressLine: scEmployees.addressLine,
        emergencyContactName: scEmployees.emergencyContactName,
        emergencyContactPhone: scEmployees.emergencyContactPhone,
      })
      .from(scEmployees)
      .leftJoin(
        scDepartments,
        eq(scDepartments.id, scEmployees.departmentId),
      )
      .where(eq(scEmployees.traceyTenantId, tenantId))
      .orderBy(asc(scEmployees.fullName)),
  );

  // Prefetch detail-modal payloads: team documents per employee, and the
  // next ~10 upcoming shifts per linked auth user. Both keyed for O(1)
  // lookup at row render time. Skipped for members who can't see admin
  // surfaces since the modal hides those sections anyway.
  const scEmployeeIds = scRoster.map((r) => r.id);
  const linkedUserIds = scRoster
    .map((r) => r.appUserId)
    .filter((v): v is string => v != null);

  const [docsRows, shiftRows] = scEmployeeIds.length === 0
    ? [[] as Array<{
        id: string;
        employeeId: string | null;
        title: string;
        mimeType: string;
        fileSize: number;
        uploadedAt: Date;
        expiresAt: Date | null;
      }>, [] as Array<{
        userId: string;
        startsAt: Date;
        endsAt: Date;
        locationName: string | null;
        status: string;
      }>]
    : await forTenant(tenantId).run(async (tx) => {
        const docs = await tx
          .select({
            id: scDocuments.id,
            employeeId: scDocuments.employeeId,
            title: scDocuments.title,
            mimeType: scDocuments.mimeType,
            fileSize: scDocuments.fileSize,
            uploadedAt: scDocuments.uploadedAt,
            expiresAt: scDocuments.expiresAt,
          })
          .from(scDocuments)
          .where(
            and(
              eq(scDocuments.scope, "team"),
              inArray(scDocuments.employeeId, scEmployeeIds),
            ),
          )
          .orderBy(asc(scDocuments.expiresAt));

        const shifts = linkedUserIds.length === 0
          ? []
          : await tx
              .select({
                userId: scShiftAssignments.userId,
                startsAt: scShifts.startsAt,
                endsAt: scShifts.endsAt,
                locationName: scLocations.name,
                status: scShiftAssignments.status,
              })
              .from(scShiftAssignments)
              .innerJoin(
                scShifts,
                eq(scShifts.id, scShiftAssignments.shiftId),
              )
              .leftJoin(
                scLocations,
                eq(scLocations.id, scShifts.locationId),
              )
              .where(
                and(
                  inArray(scShiftAssignments.userId, linkedUserIds),
                  gte(scShifts.startsAt, new Date()),
                ),
              )
              .orderBy(asc(scShifts.startsAt))
              .limit(linkedUserIds.length * 10);

        return [docs, shifts];
      });

  // Group rows for fast per-row lookup.
  const docsByEmployee = new Map<string, typeof docsRows>();
  for (const d of docsRows) {
    if (!d.employeeId) continue;
    const arr = docsByEmployee.get(d.employeeId) ?? [];
    arr.push(d);
    docsByEmployee.set(d.employeeId, arr);
  }
  const shiftsByUser = new Map<string, typeof shiftRows>();
  for (const s of shiftRows) {
    const arr = shiftsByUser.get(s.userId) ?? [];
    if (arr.length < 10) arr.push(s);
    shiftsByUser.set(s.userId, arr);
  }

  // Dedup: an scEmployees row already linked to an app.users (via appUserId
  // or matching email) renders as a single member-row with the SC payload
  // pulled across.
  const memberEmailToShiftcraft = new Map<string, (typeof scRoster)[number]>();
  const memberUserIdToShiftcraft = new Map<string, (typeof scRoster)[number]>();
  for (const r of scRoster) {
    if (r.appUserId) memberUserIdToShiftcraft.set(r.appUserId, r);
    if (r.email) memberEmailToShiftcraft.set(r.email.toLowerCase(), r);
  }
  const linkedShiftcraftIds = new Set<string>();
  const allMemberRows = memberRoster.map((m) => {
    const linked =
      memberUserIdToShiftcraft.get(m.userId) ??
      memberEmailToShiftcraft.get(m.email.toLowerCase());
    if (linked) linkedShiftcraftIds.add(linked.id);
    return { ...m, shiftcraft: linked ?? null };
  });
  const allShiftcraftOnly = scRoster.filter(
    (r) => !linkedShiftcraftIds.has(r.id),
  );

  // Search filter — name OR email OR mobile substring.
  const memberRows = q
    ? allMemberRows.filter((r) =>
        [r.name, r.email, r.shiftcraft?.mobile]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(q)),
      )
    : allMemberRows;
  const shiftcraftOnly = q
    ? allShiftcraftOnly.filter((r) =>
        [r.fullName, r.email, r.mobile]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(q)),
      )
    : allShiftcraftOnly;

  const shown = memberRows.length + shiftcraftOnly.length;
  const total = allMemberRows.length + allShiftcraftOnly.length;

  // Admin extras — pending invites + mini audit feed.
  const pending = canManage
    ? await db
        .select({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .where(eq(invitations.tenantId, tenantId))
        .orderBy(desc(invitations.createdAt))
    : [];

  const recentAudit = canManage
    ? await db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          actorEmail: auditEvents.actorEmail,
          targetKind: auditEvents.targetKind,
          targetId: auditEvents.targetId,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, tenantId))
        .orderBy(desc(auditEvents.createdAt))
        .limit(25)
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      {/* ─── Header ─── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Showing {shown} of {total}{" "}
            {total === 1 ? "person" : "people"} on the roster for{" "}
            {membership.tenant.name}.
          </p>
        </div>
        {canManage ? (
          <Button asChild>
            <Link href="/app/employees/new">Add employee</Link>
          </Button>
        ) : null}
      </div>

      {added === "1" ? (
        <div className="rounded-md border-2 border-emerald-500/60 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-950/50 dark:text-emerald-100">
          Employee added.
        </div>
      ) : null}

      {/* ─── Search ─── */}
      <form
        method="get"
        className="flex flex-wrap items-center gap-2"
      >
        <input
          type="search"
          name="q"
          defaultValue={rawQ ?? ""}
          placeholder="Search by name, email, mobile"
          className="h-9 min-w-[14rem] flex-1 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
        {q ? (
          <Button asChild type="button" size="sm" variant="ghost">
            <Link href="/app/people/team">Clear</Link>
          </Button>
        ) : null}
      </form>

      {/* ─── Invite teammate (admin only, collapsed by default) ─── */}
      {canManage ? (
        <details className="rounded-lg border border-border bg-card shadow-sm">
          <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium hover:bg-muted/30">
            <span>Invite a teammate</span>
            <span className="text-xs text-muted-foreground">
              Sends an email · expires in 7 days
            </span>
          </summary>
          <div className="border-t border-border px-5 py-4">
            <InviteForm />
          </div>
        </details>
      ) : null}

      {/* ─── Team members table ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-border bg-muted/30 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div>Name</div>
          <div>Access</div>
          <div>Pay rates</div>
          <div className="w-16" />
        </div>
        {shown === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            {q
              ? "No one matches that search."
              : "No one on the roster yet — use Add employee to get started."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {memberRows.map((r) => {
              const rate = formatRate(r.shiftcraft?.hourlyRate ?? null);
              return (
                <li
                  key={`m-${r.memberId}`}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      name={r.name}
                      email={r.email}
                      image={r.image}
                      sizeClass="h-9 w-9"
                      textClass="text-xs"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {r.shiftcraft ? (
                          <EmployeeNameButton
                            display={r.name ?? r.email}
                            canManage={canManage}
                            employee={buildEmployeeDetail(
                              r.shiftcraft,
                              r.role,
                              docsByEmployee.get(r.shiftcraft.id) ?? [],
                              shiftsByUser.get(r.userId) ?? [],
                            )}
                          />
                        ) : (
                          r.name ?? r.email
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.name ? r.email : null}
                        {r.shiftcraft?.department
                          ? ` · ${r.shiftcraft.department}`
                          : ""}
                        {r.shiftcraft?.mobile ? ` · ${r.shiftcraft.mobile}` : ""}
                      </div>
                      <OnboardingPill
                        status={
                          r.shiftcraft?.onboardingStatus as
                            | ScOnboardingStatus
                            | undefined
                        }
                        employeeId={r.shiftcraft?.id ?? null}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ROLE_BADGE[r.role] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {friendlyRoleLabel(r.role)}
                    </span>
                    {r.shiftcraft ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${EMPLOYMENT_BADGE[r.shiftcraft.employmentType as ScEmploymentType]}`}
                      >
                        {EMPLOYMENT_LABEL[r.shiftcraft.employmentType as ScEmploymentType]}
                      </span>
                    ) : null}
                  </div>
                  <div className="min-w-[10rem] text-right text-xs leading-snug">
                    {rate ? (
                      <>
                        <div>
                          <span className="text-muted-foreground">Hourly:</span>{" "}
                          <span className="font-semibold tabular-nums">{rate}</span>
                        </div>
                        <div className="text-muted-foreground">
                          Overtime after 40 hrs: x1.5
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="flex justify-end">
                    {r.shiftcraft ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/app/employees/${r.shiftcraft.id}/edit`}>
                          Edit
                        </Link>
                      </Button>
                    ) : canManage ? (
                      <Button asChild variant="outline" size="sm">
                        <Link
                          href={`/app/employees/new?email=${encodeURIComponent(r.email)}&fullName=${encodeURIComponent(r.name ?? "")}`}
                        >
                          Add to roster
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
            {shiftcraftOnly.map((r) => {
              const rate = formatRate(r.hourlyRate);
              return (
                <li
                  key={`sc-${r.id}`}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      name={r.fullName}
                      email={r.email ?? r.fullName}
                      image={null}
                      sizeClass="h-9 w-9"
                      textClass="text-xs"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        <EmployeeNameButton
                          display={r.fullName}
                          canManage={canManage}
                          employee={buildEmployeeDetail(
                            r,
                            null,
                            docsByEmployee.get(r.id) ?? [],
                            r.appUserId
                              ? shiftsByUser.get(r.appUserId) ?? []
                              : [],
                          )}
                        />
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.email ?? "No email"}
                        {r.department ? ` · ${r.department}` : ""}
                        {r.mobile ? ` · ${r.mobile}` : ""}
                      </div>
                      <OnboardingPill
                        status={
                          r.onboardingStatus as ScOnboardingStatus | undefined
                        }
                        employeeId={r.id}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${EMPLOYMENT_BADGE[r.employmentType as ScEmploymentType]}`}
                    >
                      {EMPLOYMENT_LABEL[r.employmentType as ScEmploymentType]}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      ShiftCraft only
                    </span>
                  </div>
                  <div className="min-w-[10rem] text-right text-xs leading-snug">
                    {rate ? (
                      <>
                        <div>
                          <span className="text-muted-foreground">Hourly:</span>{" "}
                          <span className="font-semibold tabular-nums">{rate}</span>
                        </div>
                        <div className="text-muted-foreground">
                          Overtime after 40 hrs: x1.5
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/app/employees/${r.id}/edit`}>Edit</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ─── Pending invitations (admin only) ─── */}
      {canManage && pending.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold">
              Pending invitations ({pending.length})
            </h2>
          </div>
          <ul className="divide-y divide-border">
            {pending.map((inv) => {
              const expired = inv.expiresAt.getTime() < Date.now();
              return (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {inv.email}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {expired ? (
                        <span className="text-amber-600">Expired</span>
                      ) : (
                        <>Expires {fmtJoined(inv.expiresAt)}</>
                      )}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ROLE_BADGE[inv.role] ?? "bg-muted text-muted-foreground"}`}
                  >
                    {friendlyRoleLabel(inv.role)}
                  </span>
                  <form action={revokeInvitationAction}>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <RevokeInvitationButton />
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* ─── Recent activity (admin only, collapsed) ─── */}
      {canManage ? (
        <div className="space-y-2">
          <details className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer items-center justify-between border-b border-border px-5 py-3 text-base font-semibold hover:bg-muted/30">
              <span>Recent activity</span>
              <span className="text-xs font-normal text-muted-foreground">
                Last {recentAudit.length} events
              </span>
            </summary>
            {recentAudit.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No recorded activity in this workspace yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {recentAudit.map((r) => (
                  <li key={r.id} className="space-y-1 px-5 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${actionTone(r.action)}`}
                      >
                        {r.action}
                      </span>
                      {r.targetKind ? (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {r.targetKind}
                          {r.targetId ? `:${r.targetId.slice(0, 8)}` : ""}
                        </span>
                      ) : null}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {fmtWhen(r.createdAt)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.actorEmail ?? "system"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </details>
          <div className="text-right">
            <Link
              href="/app/audit"
              className="text-xs text-muted-foreground hover:underline"
            >
              Full audit log →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
