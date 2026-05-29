import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  lmsDepartments,
  lmsEmployers,
  lmsMachines,
  lmsPositions,
  lmsUserMachines,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { updateEmployeeAction } from "../../actions";
import { ResetPasswordForm } from "./_reset-password-form";

export const metadata = { title: "Edit employee" };

export default async function EditEmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; msg?: string; reset?: string; pw?: string; emailed?: string }>;
}) {
  const { id } = await params;
  const userId = parseInt(id, 10);
  if (!Number.isFinite(userId)) notFound();
  const sp = await searchParams;

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [user] = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsUsers)
      .where(and(eq(lmsUsers.id, userId), eq(lmsUsers.traceyTenantId, tid)))
      .limit(1),
  );
  if (!user) notFound();

  const [departments, employers, positions, machines, userMachines, employer] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsDepartments)
        .where(tenantWhere(lmsDepartments, tid))
        .orderBy(asc(lmsDepartments.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsEmployers)
        .where(tenantWhere(lmsEmployers, tid))
        .orderBy(asc(lmsEmployers.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsPositions.id, name: lmsPositions.name })
        .from(lmsPositions)
        .where(tenantWhere(lmsPositions, tid))
        .orderBy(asc(lmsPositions.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsMachines.id, name: lmsMachines.name })
        .from(lmsMachines)
        .where(tenantWhere(lmsMachines, tid))
        .orderBy(asc(lmsMachines.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ machineId: lmsUserMachines.machineId })
        .from(lmsUserMachines)
        .where(and(eq(lmsUserMachines.userId, userId), tenantWhere(lmsUserMachines, tid))),
    ),
    user.employerId
      ? ctx.db.run((tx) =>
          tx
            .select()
            .from(lmsEmployers)
            .where(and(eq(lmsEmployers.id, user.employerId!), tenantWhere(lmsEmployers, tid)))
            .limit(1),
        )
      : Promise.resolve([] as Array<typeof lmsEmployers.$inferSelect>),
  ]);
  const linkedMachineIds = new Set(userMachines.map((m) => m.machineId));
  const employerName = employer[0]?.name ?? "";

  return (
    <div className="space-y-4">
      <BackLink href="/app/admin/employees">Back to employees</BackLink>

      {sp.reset === "1" && sp.pw && (
        <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-3 text-sm dark:bg-emerald-900/10">
          <strong>Password reset.</strong> Temporary password:{" "}
          <code className="rounded bg-[color:var(--secondary)] px-1.5 py-0.5">{sp.pw}</code>
          {sp.emailed === "1" ? " (emailed to the user)" : " (email failed — share manually)"}
        </div>
      )}
      {sp.error === "date" && (
        <div className="rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-4 py-2 text-sm text-[color:var(--destructive)]">
          Date format wrong. Use YYYY-MM-DD.
        </div>
      )}
      {sp.error === "missing" && (
        <div className="rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-4 py-2 text-sm text-[color:var(--destructive)]">
          Some required fields are missing.
        </div>
      )}
      {sp.error === "photo" && (
        <div className="rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-4 py-2 text-sm text-[color:var(--destructive)]">
          Photo not saved: {sp.msg ?? "unknown error"}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Edit {user.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={updateEmployeeAction}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <input type="hidden" name="id" value={user.id} />
            <FieldText label="First name" name="first_name" defaultValue={user.firstName ?? ""} required />
            <FieldText label="Last name" name="last_name" defaultValue={user.lastName ?? ""} required />
            <FieldText label="Email (read-only)" name="_email" defaultValue={user.email} disabled />
            <FieldText label="Phone" name="phone" defaultValue={user.phone ?? ""} required />

            <div className="space-y-1.5">
              <Label htmlFor="department_id">Department *</Label>
              <select
                id="department_id"
                name="department_id"
                defaultValue={user.departmentId ?? ""}
                required
                className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
              >
                <option value="">— Select —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="employer_name">Employer *</Label>
              <Input
                id="employer_name"
                name="employer_name"
                list="emp-list"
                defaultValue={employerName}
                required
              />
              <datalist id="emp-list">
                {employers.map((e) => (
                  <option key={e.id} value={e.name} />
                ))}
              </datalist>
            </div>

            <FieldText label="Job title" name="job_title" defaultValue={user.jobTitle ?? ""} />

            <div className="space-y-1.5">
              <Label htmlFor="position_id">Position</Label>
              <select
                id="position_id"
                name="position_id"
                defaultValue={user.positionId ?? ""}
                className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
              >
                <option value="">— None —</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <FieldText
              label="Start date"
              name="start_date"
              type="date"
              defaultValue={user.startDate ?? ""}
            />
            <FieldText
              label="Termination date"
              name="termination_date"
              type="date"
              defaultValue={user.terminationDate ?? ""}
            />

            <div className="sm:col-span-2 lg:col-span-3 space-y-1.5">
              <Label>Profile photo</Label>
              <div className="flex flex-wrap items-start gap-4">
                {user.photoFilename ? (
                  <img
                    src={`/uploads/${encodeURIComponent(user.photoFilename)}`}
                    alt={`${user.name} photo`}
                    className="h-24 w-24 rounded-md border border-[color:var(--border)] object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed border-[color:var(--border)] text-xs text-[color:var(--muted-foreground)]">
                    No photo
                  </div>
                )}
                <div className="flex-1 space-y-2">
                  <Input
                    id="photo"
                    name="photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                  />
                  <p className="text-xs text-[color:var(--muted-foreground)]">
                    JPEG/PNG/WebP/GIF up to 8 MB. Resized + re-encoded server-side.
                  </p>
                  {user.photoFilename && (
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" name="remove_photo" value="1" />
                      Remove the current photo on save
                    </label>
                  )}
                </div>
              </div>
            </div>

            <div className="sm:col-span-2 lg:col-span-3 space-y-1.5">
              <Label>Machine competencies</Label>
              {machines.length === 0 ? (
                <p className="text-xs text-[color:var(--muted-foreground)]">
                  No machines configured yet.
                </p>
              ) : (
                <div className="grid gap-1 max-h-48 overflow-y-auto rounded-md border border-[color:var(--border)] p-3 sm:grid-cols-2">
                  {machines.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="machine_ids"
                        value={m.id}
                        defaultChecked={linkedMachineIds.has(m.id)}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="sm:col-span-2 lg:col-span-3 flex gap-2">
              <Button type="submit">Save</Button>
              <Button asChild variant="outline">
                <Link href="/app/admin/employees">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Generates a new temporary password and emails it to {user.email}.
            The password is also shown to you once so you can share it
            manually if email delivery fails.
          </p>
          <ResetPasswordForm id={user.id} email={user.email} />
        </CardContent>
      </Card>
    </div>
  );
}

function FieldText({
  label,
  name,
  defaultValue,
  type,
  required,
  disabled,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required && " *"}
      </Label>
      <Input
        id={name}
        name={name}
        type={type ?? "text"}
        defaultValue={defaultValue ?? ""}
        required={required}
        disabled={disabled}
      />
    </div>
  );
}
