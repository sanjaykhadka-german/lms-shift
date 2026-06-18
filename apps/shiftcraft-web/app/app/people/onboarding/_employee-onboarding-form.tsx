"use client";

import * as React from "react";
import { useActionState, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardBody, CardHeader, CardTitle, Eyebrow } from "~/components/ui/card";
import { Segmented } from "~/components/ui/segmented";
import { cn } from "~/lib/utils";
import {
  submitEmployeeOnboardingAction,
  uploadOnboardingDocumentAction,
  type EmployeeOnboardingState,
  type OnboardingDocumentState,
} from "./_employee-onboarding-actions";

const initial: EmployeeOnboardingState = { status: "idle" };
const docInitial: OnboardingDocumentState = { status: "idle" };

// Mirrors the server-side allow-list (DOC_ALLOWED_MIMES) so the OS file picker
// only offers acceptable types. The action re-validates regardless.
const DOC_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt";

type Errors = Record<string, string[] | undefined>;

export interface OnboardingDefaults {
  fullName?: string;
  preferredName?: string;
  email?: string;
  mobile?: string;
  addressLine?: string;
}

/**
 * Employee self-service onboarding form — the ShiftCraft equivalent of the
 * Deputy onboarding the team reviewed. Colour-coded sections, the same field
 * set (Personal, Bank, TFN declaration, Super, Additional questions,
 * Documents) and stricter required-field validation than Deputy enforced.
 *
 * Bind the employee id from the page:
 *   <EmployeeOnboardingForm employeeId={employee.id} defaults={…} />
 */
export function EmployeeOnboardingForm({
  employeeId,
  defaults = {},
}: {
  employeeId: string;
  defaults?: OnboardingDefaults;
}) {
  const [state, action, pending] = useActionState(
    submitEmployeeOnboardingAction.bind(null, employeeId),
    initial,
  );
  const errs: Errors = state.status === "error" ? state.fieldErrors ?? {} : {};

  // Controlled toggles (Segmented is controlled; a hidden input carries the
  // value into FormData).
  const [hasTfn, setHasTfn] = useState("yes");
  const [claimThreshold, setClaimThreshold] = useState("yes");
  const [studyLoan, setStudyLoan] = useState("no");
  const [superEligible, setSuperEligible] = useState("yes");
  const [superChoice, setSuperChoice] = useState("own");

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-5">
      <Section
        step={1}
        accent="bg-emerald-400"
        eyebrow="About you"
        title="Personal details"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="fullName"
            label="Full legal name"
            required
            defaultValue={defaults.fullName}
            autoComplete="name"
            error={errs.fullName}
          />
          <TextField
            name="preferredName"
            label="Preferred name"
            defaultValue={defaults.preferredName}
            error={errs.preferredName}
          />
          <TextField
            name="dateOfBirth"
            label="Date of birth"
            type="date"
            required
            error={errs.dateOfBirth}
          />
          <SelectField name="gender" label="Gender" error={errs.gender}>
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="non_binary">Non-binary</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </SelectField>
          <TextField
            name="email"
            label="Email address"
            type="email"
            required
            defaultValue={defaults.email}
            autoComplete="email"
            error={errs.email}
          />
          <TextField
            name="mobile"
            label="Mobile number"
            type="tel"
            required
            defaultValue={defaults.mobile}
            autoComplete="tel"
            placeholder="+61 4xx xxx xxx"
            error={errs.mobile}
          />
        </div>
        <TextField
          name="addressLine"
          label="Residential address"
          required
          defaultValue={defaults.addressLine}
          autoComplete="street-address"
          error={errs.addressLine}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            name="emergencyContactName"
            label="Emergency contact"
            required
            error={errs.emergencyContactName}
          />
          <TextField
            name="emergencyContactPhone"
            label="Their phone"
            type="tel"
            required
            error={errs.emergencyContactPhone}
          />
          <TextField
            name="emergencyContactRelationship"
            label="Relationship"
            required
            placeholder="e.g. Spouse, Parent"
            hint="Not a phone number"
            error={errs.emergencyContactRelationship}
          />
        </div>
      </Section>

      <Section
        step={2}
        accent="bg-sky-400"
        eyebrow="Where you're paid"
        title="Bank details"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="bankAccountName"
            label="Account name"
            required
            defaultValue={defaults.fullName}
            error={errs.bankAccountName}
          />
          <div className="hidden sm:block" />
          <TextField
            name="bsb"
            label="BSB"
            required
            inputMode="numeric"
            placeholder="123-456"
            error={errs.bsb}
          />
          <TextField
            name="accountNumber"
            label="Account number"
            required
            inputMode="numeric"
            error={errs.accountNumber}
          />
        </div>
      </Section>

      <Section
        step={3}
        accent="bg-violet-400"
        eyebrow="ATO"
        title="Tax file number declaration"
      >
        <ToggleField
          name="hasTfn"
          label="Do you have a Tax File Number (TFN)?"
          value={hasTfn}
          onChange={setHasTfn}
          options={YES_NO}
        />
        {hasTfn === "yes" && (
          <TextField
            name="tfn"
            label="Tax File Number"
            required
            inputMode="numeric"
            placeholder="123 456 789"
            error={errs.tfn}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField name="residency" label="Residency status" required error={errs.residency}>
            <option value="">Select…</option>
            <option value="resident">Australian resident for tax purposes</option>
            <option value="foreign">Foreign resident</option>
            <option value="working_holiday">Working holiday maker</option>
          </SelectField>
          <SelectField name="payBasis" label="Basis of payment" required error={errs.payBasis}>
            <option value="">Select…</option>
            <option value="full_time">Full time</option>
            <option value="part_time">Part time</option>
            <option value="casual">Casual</option>
            <option value="labour_hire">Labour hire</option>
          </SelectField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ToggleField
            name="claimTaxFreeThreshold"
            label="Claim the tax-free threshold?"
            value={claimThreshold}
            onChange={setClaimThreshold}
            options={YES_NO}
          />
          <ToggleField
            name="hasStudyLoan"
            label="HELP / VSL / SSL / study-loan debt?"
            value={studyLoan}
            onChange={setStudyLoan}
            options={YES_NO}
          />
        </div>
        <label className="flex items-start gap-2.5 rounded-[var(--r-sm)] border border-line bg-[var(--paper-2)] px-3 py-2.5 text-sm text-ink-2">
          <input
            type="checkbox"
            name="declarationTrue"
            className="mt-0.5 h-4 w-4 accent-[var(--accent-deep)]"
          />
          <span>I declare the information I have given is true and correct.</span>
        </label>
        <FieldError errors={errs.declarationTrue} />
      </Section>

      <Section
        step={4}
        accent="bg-amber-400"
        eyebrow="Retirement"
        title="Superannuation"
      >
        <ToggleField
          name="superEligible"
          label="Are you eligible for superannuation?"
          value={superEligible}
          onChange={setSuperEligible}
          options={YES_NO}
        />
        <ToggleField
          name="superChoice"
          label="I'd like super paid to…"
          value={superChoice}
          onChange={setSuperChoice}
          options={[
            { value: "own", label: "My own fund" },
            { value: "employer_default", label: "Employer default" },
          ]}
        />
        {superChoice === "own" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="superFundName"
              label="Super fund name"
              required
              placeholder="e.g. HESTA Super"
              error={errs.superFundName}
            />
            <TextField
              name="superMemberNumber"
              label="Member number"
              required
              error={errs.superMemberNumber}
            />
          </div>
        )}
      </Section>

      <Section
        step={5}
        accent="bg-rose-400"
        eyebrow="Eligibility"
        title="Additional questions"
      >
        <SelectField
          name="workVisa"
          label="Do you have a valid right to work in Australia?"
          required
          error={errs.workVisa}
        >
          <option value="">Select…</option>
          <option value="citizen_or_pr">Yes — Australian citizen / permanent resident</option>
          <option value="yes_attached">Yes — valid work visa (attached below)</option>
          <option value="no">No</option>
        </SelectField>
      </Section>

      {state.status === "error" && (
        <p className="rounded-[var(--r-sm)] border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
          {state.message}
        </p>
      )}
      {state.status === "ok" && (
        <p className="rounded-[var(--r-sm)] border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
          {state.message}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Submitting…" : "Submit onboarding"}
        </Button>
      </div>
      </form>

      <DocumentsSection employeeId={employeeId} />
    </div>
  );
}

// ── Documents (step 6) ──────────────────────────────────────────────────────
//
// Rendered OUTSIDE the main form: HTML forms can't nest, and each upload posts
// independently to uploadOnboardingDocumentAction (its own request → its own
// 5 MB body budget) so a file upload doesn't have to ride — or block — the main
// "Submit onboarding" submit. Named slots cover the documents we usually need;
// "Add another document" covers anything else (certifications, etc.).

function DocumentsSection({ employeeId }: { employeeId: string }) {
  const [extras, setExtras] = useState<number[]>([]);
  const [nextId, setNextId] = useState(0);

  return (
    <Section
      step={6}
      accent="bg-slate-400"
      eyebrow="Upload"
      title="Documents we need from you"
    >
      <p className="text-sm text-ink-2">
        Attach a clear photo or PDF of each. Each file is saved as soon as you
        press Upload — you don't need to wait for the form above.
      </p>
      <p className="text-xs text-ink-3">
        Max 5 MB per file · PDF, JPG, PNG, WebP, DOC, DOCX, TXT.
      </p>

      <div className="space-y-3">
        <DocumentUploadRow
          employeeId={employeeId}
          fixedTitle="Photo ID / Passport"
        />
        <DocumentUploadRow
          employeeId={employeeId}
          fixedTitle="Visa / work rights"
        />
        <DocumentUploadRow
          employeeId={employeeId}
          fixedTitle="Driver's licence"
        />
        {extras.map((id) => (
          <DocumentUploadRow key={id} employeeId={employeeId} />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setExtras((prev) => [...prev, nextId]);
          setNextId((n) => n + 1);
        }}
      >
        + Add another document
      </Button>
    </Section>
  );
}

function DocumentUploadRow({
  employeeId,
  fixedTitle,
}: {
  employeeId: string;
  fixedTitle?: string;
}) {
  const [state, formAction, pending] = useActionState(
    uploadOnboardingDocumentAction.bind(null, employeeId),
    docInitial,
  );
  const errs: Errors = state.status === "error" ? state.fieldErrors ?? {} : {};

  return (
    <form
      action={formAction}
      className="rounded-[var(--r-sm)] border border-line bg-[var(--paper-2)] p-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          {fixedTitle ? (
            <>
              <Label>{fixedTitle}</Label>
              <input type="hidden" name="title" value={fixedTitle} />
            </>
          ) : (
            <>
              <Label htmlFor={`doc-title-${employeeId}`}>Document name</Label>
              <Input
                name="title"
                placeholder="e.g. First-aid certificate"
                aria-invalid={errs.title?.length ? true : undefined}
              />
              <FieldError errors={errs.title} />
            </>
          )}
          <input
            name="file"
            type="file"
            accept={DOC_ACCEPT}
            className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-[var(--r-sm)] file:border file:border-line file:bg-[var(--paper)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-[var(--raise)]"
          />
          <FieldError errors={errs.file} />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {state.status === "ok" && (
        <p className="mt-2 text-xs text-[var(--live)]">{state.message}</p>
      )}
      {state.status === "error" && !state.fieldErrors && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}

// ── Building blocks ───────────────────────────────────────────────────────

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const selectClass =
  "flex h-10 w-full rounded-[var(--r-sm)] border border-line bg-[var(--paper)] px-3 py-1 text-sm text-ink shadow-sm transition-colors focus-visible:border-[var(--accent-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] disabled:cursor-not-allowed disabled:opacity-50";

function Section({
  step,
  accent,
  eyebrow,
  title,
  children,
}: {
  step: number;
  accent: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex">
        <div className={cn("w-1.5 shrink-0", accent)} aria-hidden />
        <div className="min-w-0 flex-1">
          <CardHeader>
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                accent,
              )}
            >
              {step}
            </span>
            <div className="flex flex-col">
              <Eyebrow>{eyebrow}</Eyebrow>
              <CardTitle>{title}</CardTitle>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">{children}</CardBody>
        </div>
      </div>
    </Card>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors[0]}</p>;
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
      <FieldError errors={error} />
    </div>
  );
}

function TextField({
  name,
  label,
  required,
  hint,
  error,
  ...rest
}: {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string[];
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} htmlFor={name} required={required} hint={hint} error={error}>
      <Input id={name} name={name} aria-invalid={error?.length ? true : undefined} {...rest} />
    </Field>
  );
}

function SelectField({
  name,
  label,
  required,
  error,
  children,
}: {
  name: string;
  label: string;
  required?: boolean;
  error?: string[];
  children: React.ReactNode;
}) {
  return (
    <Field label={label} htmlFor={name} required={required} error={error}>
      <select
        id={name}
        name={name}
        defaultValue=""
        className={selectClass}
        aria-invalid={error?.length ? true : undefined}
      >
        {children}
      </select>
    </Field>
  );
}

function ToggleField({
  name,
  label,
  value,
  onChange,
  options,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: React.ReactNode }[];
}) {
  return (
    <Field label={label}>
      <div>
        <Segmented options={options} value={value} onValueChange={onChange} />
      </div>
      <input type="hidden" name={name} value={value} />
    </Field>
  );
}

