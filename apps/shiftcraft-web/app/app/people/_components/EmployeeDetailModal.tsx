"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";

// Deputy-style employee profile modal. Tabbed left-rail navigation with
// section labels; right pane swaps content per tab. All data is pushed
// in as props — no client-side fetching. Tabs we can't fully populate
// today (Payroll, Right to work, Activity, Journals) are intentionally
// excluded; this slice ships what we actually have.

const GENDER_LABEL: Record<string, string> = {
  female: "Female",
  male: "Male",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  casual: "Casual",
  contractor: "Contractor",
};

const ONBOARDING_LABEL: Record<string, string> = {
  pending: "Onboarding pending",
  in_progress: "Onboarding in progress",
  active: "Onboarded",
};

const ONBOARDING_TONE: Record<string, string> = {
  pending: "bg-amber-500 text-white",
  in_progress: "bg-blue-600 text-white",
  active: "bg-emerald-600 text-white",
};

const TABS = [
  { id: "personal", label: "Personal", section: "PROFILE" },
  { id: "employment", label: "Employment", section: "PROFILE" },
  { id: "documents", label: "Documents", section: "PROFILE" },
  { id: "shifts", label: "Shifts", section: "SCHEDULING" },
  { id: "availability", label: "Availability", section: "SCHEDULING" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export interface EmployeeDetailDocument {
  id: string;
  title: string;
  mimeType: string;
  fileSize: number;
  uploadedAtIso: string;
  expiresAtIso: string | null;
}

export interface EmployeeDetailShift {
  startsAtIso: string;
  endsAtIso: string;
  locationName: string | null;
  status: string;
}

export interface EmployeeDetail {
  id: string;
  fullName: string;
  preferredName: string | null;
  email: string | null;
  mobile: string | null;
  gender: string | null;
  dateOfBirthIso: string | null;
  addressLine: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  departmentName: string | null;
  employmentType: string;
  hourlyRate: string | null;
  hireDateIso: string;
  notes: string | null;
  isActive: boolean;
  onboardingStatus: "pending" | "in_progress" | "active";
  onboardingStartedAtIso: string | null;
  onboardingCompletedAtIso: string | null;
  availability: Record<string, string> | null;
  documents: EmployeeDetailDocument[];
  shifts: EmployeeDetailShift[];
  appUserId: string | null;
  authRole: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  employee: EmployeeDetail;
  canManage: boolean;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function age(iso: string | null): string | null {
  if (!iso) return null;
  const dob = new Date(iso);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) years -= 1;
  return `${years} years old`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtRate(rate: string | null): string {
  if (!rate) return "—";
  const n = Number(rate);
  if (Number.isNaN(n)) return "—";
  return `$${n.toFixed(2)} / hr`;
}

export function EmployeeDetailModal({
  open,
  onClose,
  employee,
  canManage,
}: Props) {
  const [tab, setTab] = useState<TabId>("personal");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset to Personal whenever a new modal opens.
  useEffect(() => {
    if (open) setTab("personal");
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const sections = Array.from(new Set(TABS.map((t) => t.section)));

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Employee profile for ${employee.fullName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex h-[90vh] max-h-[920px] w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        {/* ─── Left rail ─── */}
        <aside className="flex w-64 flex-col border-r border-border bg-muted/20">
          <div className="flex flex-col items-center gap-2 border-b border-border px-5 py-6">
            <Avatar
              name={employee.fullName}
              email={employee.email ?? employee.fullName}
              image={null}
              sizeClass="h-20 w-20"
              textClass="text-2xl"
            />
            <div className="mt-2 text-center">
              <div className="text-sm font-semibold">{employee.fullName}</div>
              <div className="text-xs text-muted-foreground">
                {employee.shifts.length > 0
                  ? `${employee.shifts.length} upcoming shifts`
                  : "No scheduled shifts"}
              </div>
            </div>
            {employee.onboardingStatus !== "active" ? (
              <span
                className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${ONBOARDING_TONE[employee.onboardingStatus]}`}
              >
                {ONBOARDING_LABEL[employee.onboardingStatus]}
              </span>
            ) : null}
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
            {sections.map((section) => (
              <div key={section}>
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section}
                </div>
                <div className="space-y-0.5">
                  {TABS.filter((t) => t.section === section).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={
                        tab === t.id
                          ? "block w-full rounded-md bg-primary px-3 py-1.5 text-left text-sm font-medium text-primary-foreground"
                          : "block w-full rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                      }
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* ─── Right pane ─── */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-xl font-semibold tracking-tight">
              {TABS.find((t) => t.id === tab)?.label}
            </h2>
            <div className="flex items-center gap-2">
              {canManage ? (
                <Button asChild>
                  <Link
                    href={`/app/employees/${employee.id}/edit`}
                    onClick={onClose}
                  >
                    Edit
                  </Link>
                </Button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md border border-border bg-background p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span className="block h-4 w-4 leading-none">✕</span>
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {tab === "personal" ? (
              <PersonalTab employee={employee} />
            ) : tab === "employment" ? (
              <EmploymentTab employee={employee} />
            ) : tab === "documents" ? (
              <DocumentsTab employee={employee} />
            ) : tab === "shifts" ? (
              <ShiftsTab employee={employee} />
            ) : tab === "availability" ? (
              <AvailabilityTab employee={employee} />
            ) : null}
          </div>
        </main>
      </div>
    </div>,
    document.body,
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <div className="grid gap-4 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium">{value || "—"}</div>
    </div>
  );
}

function PersonalTab({ employee }: { employee: EmployeeDetail }) {
  const dob = employee.dateOfBirthIso;
  const ageLabel = age(dob);
  return (
    <div className="space-y-6">
      <SectionCard title="Personal details">
        <Field label="Name" value={employee.fullName} />
        <Field
          label="Preferred name"
          value={employee.preferredName || employee.fullName}
        />
        <Field
          label="Gender"
          value={employee.gender ? GENDER_LABEL[employee.gender] ?? employee.gender : null}
        />
        <Field
          label="Date of birth"
          value={
            dob ? `${fmtDate(dob)}${ageLabel ? ` (${ageLabel})` : ""}` : null
          }
        />
      </SectionCard>

      <SectionCard title="Contact">
        <Field label="Email" value={employee.email} />
        <Field label="Mobile" value={employee.mobile} />
        <Field label="Address" value={employee.addressLine} />
        <Field
          label="Emergency contact"
          value={employee.emergencyContactName}
        />
        <Field
          label="Emergency phone"
          value={employee.emergencyContactPhone}
        />
      </SectionCard>

      {employee.notes ? (
        <SectionCard title="Notes">
          <div className="sm:col-span-2 text-sm">{employee.notes}</div>
        </SectionCard>
      ) : null}
    </div>
  );
}

function EmploymentTab({ employee }: { employee: EmployeeDetail }) {
  return (
    <div className="space-y-6">
      <SectionCard title="Employment">
        <Field label="Department" value={employee.departmentName} />
        <Field
          label="Employment type"
          value={EMPLOYMENT_LABEL[employee.employmentType] ?? employee.employmentType}
        />
        <Field
          label="Status"
          value={
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${employee.isActive ? "bg-emerald-600 text-white" : "bg-slate-500 text-white"}`}
            >
              {employee.isActive ? "Active" : "Inactive"}
            </span>
          }
        />
        <Field
          label="Hire date"
          value={fmtDate(employee.hireDateIso)}
        />
        <Field label="Hourly rate" value={fmtRate(employee.hourlyRate)} />
        <Field
          label="Workspace role"
          value={
            employee.authRole
              ? employee.authRole.charAt(0).toUpperCase() +
                employee.authRole.slice(1)
              : "No login"
          }
        />
      </SectionCard>

      <SectionCard title="Onboarding">
        <Field
          label="Status"
          value={
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ONBOARDING_TONE[employee.onboardingStatus]}`}
            >
              {ONBOARDING_LABEL[employee.onboardingStatus]}
            </span>
          }
        />
        <Field
          label="Started"
          value={fmtDate(employee.onboardingStartedAtIso)}
        />
        <Field
          label="Completed"
          value={fmtDate(employee.onboardingCompletedAtIso)}
        />
        <div>
          <Link
            href={`/app/people/onboarding/${employee.id}`}
            className="text-sm text-primary hover:underline"
          >
            Open onboarding checklist →
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}

function DocumentsTab({ employee }: { employee: EmployeeDetail }) {
  if (employee.documents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No documents on file. Upload from{" "}
        <Link
          href="/app/people/team-documents"
          className="text-primary hover:underline"
        >
          Team documents →
        </Link>
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-muted/30">
        {employee.documents.map((d) => {
          const expiresAt = d.expiresAtIso ? new Date(d.expiresAtIso) : null;
          const days = expiresAt
            ? Math.ceil(
                (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
              )
            : null;
          const expired = days !== null && days < 0;
          const expiringSoon = days !== null && days >= 0 && days <= 30;
          return (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/app/people/documents/${d.id}/download`}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {d.title}
                </Link>
                <div className="truncate text-xs text-muted-foreground">
                  {fmtSize(d.fileSize)} · {d.mimeType} · Uploaded{" "}
                  {fmtDate(d.uploadedAtIso)}
                </div>
              </div>
              {d.expiresAtIso ? (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                    expired
                      ? "bg-red-600 text-white"
                      : expiringSoon
                        ? "bg-amber-500 text-white"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {expired
                    ? `Expired ${fmtDate(d.expiresAtIso)}`
                    : expiringSoon
                      ? `Expires in ${days} ${days === 1 ? "day" : "days"}`
                      : `Expires ${fmtDate(d.expiresAtIso)}`}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Link
        href="/app/people/team-documents"
        className="block text-right text-xs text-muted-foreground hover:underline"
      >
        Manage all team documents →
      </Link>
    </div>
  );
}

function ShiftsTab({ employee }: { employee: EmployeeDetail }) {
  if (employee.shifts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No upcoming shifts scheduled.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-muted/30">
      {employee.shifts.map((s, i) => (
        <li
          key={i}
          className="flex items-center justify-between gap-3 px-4 py-3"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {fmtDateTime(s.startsAtIso)}
            </div>
            <div className="text-xs text-muted-foreground">
              Until {fmtDateTime(s.endsAtIso)}
              {s.locationName ? ` · ${s.locationName}` : ""}
            </div>
          </div>
          <span className="inline-flex items-center rounded-full bg-card px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ring-1 ring-border">
            {s.status}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AvailabilityTab({ employee }: { employee: EmployeeDetail }) {
  const days: Array<{ key: string; label: string }> = [
    { key: "mon", label: "Monday" },
    { key: "tue", label: "Tuesday" },
    { key: "wed", label: "Wednesday" },
    { key: "thu", label: "Thursday" },
    { key: "fri", label: "Friday" },
    { key: "sat", label: "Saturday" },
    { key: "sun", label: "Sunday" },
  ];
  const av = employee.availability ?? {};
  const anySet = days.some((d) => av[d.key] && av[d.key]!.length > 0);
  if (!anySet) {
    return (
      <p className="text-sm text-muted-foreground">
        No availability set. Edit the employee to fill in weekly availability.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {days.map((d) => (
            <tr key={d.key}>
              <td className="px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {d.label}
              </td>
              <td className="px-4 py-2 font-mono tabular-nums">
                {av[d.key] || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
