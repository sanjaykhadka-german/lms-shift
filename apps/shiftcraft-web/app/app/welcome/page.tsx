import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  forTenant,
  scDocuments,
  scEmployees,
  scEmployeeOnboardingTasks,
  scEmployeePins,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";
import { PersonalForm } from "./_personal-form";
import { PayrollPiiForm } from "./_payroll-pii-form";
import { PinForm } from "./_pin-form";
import { DocumentUploadForm } from "./_documents-form";
import {
  completeOnboardingSelfAction,
  selfMarkOnboardingTaskAction,
} from "./actions";

export const metadata = { title: "Welcome · ShiftCraft" };
export const dynamic = "force-dynamic";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function WelcomePage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const user = await requireUser();
  const tenantId = membership.tenant.id;

  const [employee] = await forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.traceyTenantId, tenantId),
          eq(scEmployees.appUserId, user.id),
        ),
      )
      .limit(1),
  );

  if (!employee) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Welcome
          <InfoPopover label="About this screen">
            <p>
              Your ShiftCraft account is signed in but you don&rsquo;t
              have a roster row yet. A manager needs to add you to the
              workforce before you can clock in or fill in onboarding
              details.
            </p>
          </InfoPopover>
        </h1>
        <section className="rounded-[var(--r-lg)] border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] p-6">
          <p className="text-sm">
            Ask your manager to add you on{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              /app/employees
            </code>
            . Once they do, return here to complete your profile.
          </p>
        </section>
      </div>
    );
  }

  const [tasks, documents, pinRows] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select()
        .from(scEmployeeOnboardingTasks)
        .where(
          and(
            eq(scEmployeeOnboardingTasks.traceyTenantId, tenantId),
            eq(scEmployeeOnboardingTasks.employeeId, employee.id),
          ),
        )
        .orderBy(asc(scEmployeeOnboardingTasks.sortOrder)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scDocuments.id,
          title: scDocuments.title,
          mimeType: scDocuments.mimeType,
          fileSize: scDocuments.fileSize,
          uploadedAt: scDocuments.uploadedAt,
        })
        .from(scDocuments)
        .where(
          and(
            eq(scDocuments.traceyTenantId, tenantId),
            eq(scDocuments.scope, "team"),
            eq(scDocuments.employeeId, employee.id),
          ),
        )
        .orderBy(desc(scDocuments.uploadedAt)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ lastUsedAt: scEmployeePins.lastUsedAt })
        .from(scEmployeePins)
        .where(
          and(
            eq(scEmployeePins.traceyTenantId, tenantId),
            eq(scEmployeePins.appUserId, user.id),
          ),
        )
        .limit(1),
    ),
  ]);
  const pin = pinRows[0] ?? null;

  const requiredOutstanding = tasks.filter(
    (t) => t.required && t.status !== "done",
  ).length;
  const canComplete = requiredOutstanding === 0;
  const alreadyActive = employee.onboardingStatus === "active";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Welcome, {employee.preferredName || employee.fullName.split(" ")[0]}
          <InfoPopover label="About the welcome flow">
            <p>
              Fill in your personal details and (optionally) payroll info,
              upload any required documents, and tick off the onboarding
              tasks your manager set up.
            </p>
            <p className="mt-1">
              Payroll details are encrypted at rest — only managers can
              reveal them, and every reveal writes to the audit log. You
              can skip the payroll section and complete it later from
              this page.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {alreadyActive
            ? "Your onboarding is complete. Use this page to update any details that change."
            : `${requiredOutstanding} required task${requiredOutstanding === 1 ? "" : "s"} remaining before you can continue to the dashboard.`}
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Personal details</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Your manager needs these for compliance. None are visible to
          other workers.
        </p>
        <PersonalForm
          defaults={{
            preferredName: employee.preferredName,
            gender: employee.gender,
            dateOfBirth: employee.dateOfBirth,
            addressLine: employee.addressLine,
            emergencyContactName: employee.emergencyContactName,
            emergencyContactPhone: employee.emergencyContactPhone,
          }}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Payroll details</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          TFN, bank, and super so your manager can run payroll. Stored
          encrypted (AES-256-GCM); revealed only to managers on click,
          with the reveal written to the audit log.
        </p>
        <PayrollPiiForm
          flags={{
            hasTfn: employee.tfnEnc !== null,
            hasBsb: employee.bsbEnc !== null,
            hasAccount: employee.accountNumberEnc !== null,
            hasSuper: employee.superMemberNumberEnc !== null,
            superFundName: employee.superFundName,
          }}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Kiosk PIN</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          A 4-digit PIN you enter at the on-premise kiosk to clock in and
          out. It&rsquo;s for kiosk use only — your web login still uses
          your email + password.
        </p>
        <PinForm hasPin={pin !== null} lastUsedAt={pin?.lastUsedAt ?? null} />
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold">My documents</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload your ID, work permit, RSA / forklift / food-handling
            certs, signed contract. Max 5 MiB per file. Managers see
            these on the Team documents page; they can flag expiring
            certs.
          </p>
        </div>
        <div className="border-b border-border px-6 py-4">
          <DocumentUploadForm />
        </div>
        {documents.length === 0 ? (
          <p className="px-6 py-6 text-sm text-muted-foreground">
            Nothing uploaded yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 px-6 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{d.title}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {d.mimeType} · {fmtBytes(d.fileSize)} · uploaded{" "}
                    {d.uploadedAt.toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <a href={`/app/people/documents/${d.id}/download`}>
                    Download
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {tasks.length > 0 && (
        <section className="rounded-lg border border-border bg-card shadow-sm">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-semibold">
              Onboarding tasks ({tasks.filter((t) => t.status === "done").length}/{tasks.length})
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Tasks your manager set up for you. Required ones must be
              done before you can mark onboarding complete.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {tasks.map((t) => {
              const isDone = t.status === "done";
              return (
                <li
                  key={t.id}
                  className="flex items-start gap-3 px-6 py-3"
                >
                  <form
                    action={selfMarkOnboardingTaskAction}
                    className="pt-0.5"
                  >
                    <input type="hidden" name="taskId" value={t.id} />
                    <input
                      type="hidden"
                      name="done"
                      value={isDone ? "0" : "1"}
                    />
                    <button
                      type="submit"
                      aria-label={
                        isDone ? "Mark as not done" : "Mark as done"
                      }
                      className={`inline-flex h-5 w-5 items-center justify-center rounded border text-xs ${
                        isDone
                          ? "border-[var(--live)] bg-[var(--live)] text-white"
                          : "border-border bg-background text-transparent hover:border-foreground"
                      }`}
                    >
                      ✓
                    </button>
                  </form>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-sm font-medium ${
                        isDone ? "line-through text-muted-foreground" : ""
                      }`}
                    >
                      {t.title}
                      {t.required && !isDone && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-[var(--warn)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                          Required
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t.description}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex items-center justify-end gap-3">
        {alreadyActive ? (
          <Button asChild variant="outline">
            <Link href="/app">← Back to dashboard</Link>
          </Button>
        ) : (
          <form action={completeOnboardingSelfAction}>
            <Button type="submit" disabled={!canComplete}>
              {canComplete
                ? "Continue to dashboard →"
                : `Finish ${requiredOutstanding} task${requiredOutstanding === 1 ? "" : "s"} first`}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
