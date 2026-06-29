"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { SignaturePad } from "~/components/SignaturePad";
import { EmployeePicker, OTHER_HOST } from "./_employee_picker";
import { PdfViewer } from "./_pdf_viewer";
import { SignOutNameInput } from "./_signout_name";
import { visitorSignInAction, visitorSignOutAction } from "./actions";

export interface SignedInVisitor {
  id: string;
  visitorName: string;
  visitorCompany: string | null;
  visitingPerson: string;
  signedInAt: string;
}

// Input border is its own class so the error state can swap *only* the border
// colour. Two `border-<colour>` utilities in one className is a footgun — CSS
// source order (not className order) decides which wins, so we never stack them.
const INPUT_BASE =
  "h-12 w-full rounded-xl border bg-[rgba(244,238,227,0.05)] px-4 text-base text-[#f4eee3] placeholder:text-[#766b5e] focus:outline-none focus:ring-2 focus:ring-[rgba(244,238,227,0.25)]";
const INPUT_BORDER_OK = "border-[rgba(244,238,227,0.18)]";
const INPUT_BORDER_ERR = "border-[var(--danger)] focus:ring-[var(--danger)]";
const INPUT = `${INPUT_BASE} ${INPUT_BORDER_OK}`;
const LABEL =
  "mb-1.5 block font-mono text-xs font-medium uppercase tracking-[0.14em] text-[#e6ddcf]";

// The wizard asks one thing per screen, in this order. Each step validates its
// own field before Next advances, so a visitor is walked through the form and
// can't skip anything. `key` doubles as the validation/error key and the DOM
// id to focus when something's missing.
const STEPS = [
  { key: "visitorName", title: "What's your full name?" },
  { key: "visitorCompany", title: "Which company are you visiting from?" },
  { key: "visitorMobile", title: "What's your mobile number?" },
  { key: "visitingEmployeeId", title: "Who are you here to see?" },
  { key: "visitReason", title: "What's the reason for your visit?" },
  { key: "broughtTools", title: "Tools or equipment" },
  { key: "recentIllness", title: "Health check" },
  { key: "policyAgreed", title: "Visitors policy" },
  { key: "signInSignature", title: "Sign to confirm" },
] as const;
type FieldKey = (typeof STEPS)[number]["key"];
const LAST_STEP = STEPS.length - 1;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="mt-2 flex items-center gap-1 text-sm font-medium text-[color-mix(in_srgb,var(--danger)_65%,white)]">
      <span aria-hidden>⚠</span>
      {msg}
    </p>
  );
}

// Two-button No/Yes toggle. Mirrors the in/out tab styling. Writes the chosen
// value into a hidden input so it submits with the form action.
function YesNo({
  name,
  value,
  invalid,
  onChange,
}: {
  name: string;
  value: "" | "yes" | "no";
  invalid?: boolean;
  onChange: (v: "yes" | "no") => void;
}) {
  return (
    <div
      className={`grid grid-cols-2 gap-2 ${
        invalid
          ? "rounded-xl ring-1 ring-[var(--danger)] ring-offset-2 ring-offset-[#1a1512]"
          : ""
      }`}
    >
      {(["no", "yes"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-xl px-4 py-4 text-base font-semibold capitalize transition ${
            value === opt
              ? opt === "yes"
                ? "bg-[var(--danger)] text-white"
                : "bg-[var(--live)] text-white"
              : "bg-[rgba(244,238,227,0.06)] text-[#a89c8c] hover:bg-[rgba(244,238,227,0.1)]"
          }`}
        >
          {opt}
        </button>
      ))}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

function SubmitButton({
  children,
  tone,
  disabled,
}: {
  children: React.ReactNode;
  tone: "in" | "out";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const bg =
    tone === "in"
      ? "bg-[var(--live)] hover:bg-[color-mix(in_srgb,var(--live)_85%,white)]"
      : "bg-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_85%,white)]";
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`w-full rounded-xl px-6 py-4 text-base font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${bg}`}
    >
      {pending ? "…" : children}
    </button>
  );
}

export function VisitorForm({
  signedInVisitors,
  employees,
}: {
  signedInVisitors: SignedInVisitor[];
  employees: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<"in" | "out">("in");
  // Current wizard step (sign-in tab only).
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const [hasSignature, setHasSignature] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  // Free-text host name used when the visitor picks "Someone else (not listed)".
  const [otherName, setOtherName] = useState("");
  // Sign-out signature is mandatory too — gate the sign-out button on it.
  const [hasSignOutSignature, setHasSignOutSignature] = useState(false);
  // Visitor-policy screening (POL 1.4.1.2). Both toggles must be answered; a
  // description is required when "yes"; the policy must be agreed to sign in.
  const [broughtTools, setBroughtTools] = useState<"" | "yes" | "no">("");
  const [toolsDescription, setToolsDescription] = useState("");
  const [recentIllness, setRecentIllness] = useState<"" | "yes" | "no">("");
  const [illnessDescription, setIllnessDescription] = useState("");
  const [policyAgreed, setPolicyAgreed] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  // Per-field validation messages, shown inline beneath each step's field.
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});

  function clearError(key: FieldKey) {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // A host is chosen when a real employee is picked, or "Other" is picked and a
  // name has been typed.
  const hostChosen =
    employeeId !== "" && (employeeId !== OTHER_HOST || otherName.trim() !== "");

  // Read an uncontrolled text input's trimmed value straight from the DOM. The
  // step inputs keep their `name`/`id` and stay mounted (hidden), so this works
  // regardless of which step is showing.
  function domVal(id: string): string {
    const el = document.getElementById(id) as HTMLInputElement | null;
    return (el?.value ?? "").trim();
  }

  // The single validation message for a field, or undefined if it's fine.
  function fieldErrorFor(key: FieldKey): string | undefined {
    switch (key) {
      case "visitorName":
        return domVal("visitorName") ? undefined : "Please enter your full name.";
      case "visitorCompany":
        return domVal("visitorCompany")
          ? undefined
          : "Please enter your company or organisation.";
      case "visitorMobile":
        return domVal("visitorMobile")
          ? undefined
          : "Please enter your mobile number.";
      case "visitingEmployeeId":
        return hostChosen
          ? undefined
          : employeeId === OTHER_HOST
            ? "Please type the name of the person you're visiting."
            : "Please choose who you're visiting.";
      case "visitReason":
        return domVal("visitReason")
          ? undefined
          : "Please enter a reason for your visit.";
      case "broughtTools":
        if (broughtTools === "") return "Please answer this question.";
        if (broughtTools === "yes" && !toolsDescription.trim())
          return "Please describe the tools or equipment.";
        return undefined;
      case "recentIllness":
        if (recentIllness === "") return "Please answer this question.";
        if (recentIllness === "yes" && !illnessDescription.trim())
          return "Please describe your symptoms.";
        return undefined;
      case "policyAgreed":
        return policyAgreed
          ? undefined
          : "Please read and agree to the Visitors Policy.";
      case "signInSignature":
        return hasSignature ? undefined : "Please add your signature.";
    }
  }

  function scrollCardTop() {
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goNext() {
    const key = STEPS[step]!.key;
    const msg = fieldErrorFor(key);
    if (msg) {
      setErrors({ [key]: msg });
      return;
    }
    setErrors({});
    setStep((s) => Math.min(s + 1, LAST_STEP));
    scrollCardTop();
  }

  function goBack() {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
    scrollCardTop();
  }

  // Final submit. Re-validate every field as a backstop; if anything's missing
  // (shouldn't happen via Next, but a stray submit could), jump back to the
  // first offending step and surface its error instead of handing off.
  async function handleSignIn(formData: FormData) {
    const errs: Partial<Record<FieldKey, string>> = {};
    for (const { key } of STEPS) {
      const msg = fieldErrorFor(key);
      if (msg) errs[key] = msg;
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      const firstIdx = STEPS.findIndex((s) => errs[s.key]);
      if (firstIdx >= 0) {
        setStep(firstIdx);
        scrollCardTop();
      }
      return;
    }
    setErrors({});
    await visitorSignInAction(formData);
  }

  // Re-fit nothing here, but make sure the card scrolls into view on step
  // change (covers the programmatic jumps from validation).
  useEffect(() => {
    if (tab === "in") scrollCardTop();
  }, [step, tab]);

  return (
    <div className="space-y-6" ref={cardRef}>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-[rgba(244,238,227,0.06)] p-1.5">
        <button
          type="button"
          onClick={() => setTab("in")}
          className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
            tab === "in"
              ? "bg-[var(--live)] text-white"
              : "text-[#a89c8c] hover:bg-[rgba(244,238,227,0.06)]"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setTab("out")}
          className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
            tab === "out"
              ? "bg-[var(--danger)] text-white"
              : "text-[#a89c8c] hover:bg-[rgba(244,238,227,0.06)]"
          }`}
        >
          Sign out
        </button>
      </div>

      {tab === "in" ? (
        <form action={handleSignIn} noValidate className="space-y-6">
          {/* Progress */}
          <div>
            <div className="flex items-center justify-between font-mono text-xs uppercase tracking-[0.14em] text-[#a89c8c]">
              <span>
                Step {step + 1} of {STEPS.length}
              </span>
              <span className="text-[#e6ddcf]">{STEPS[step]!.title}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(244,238,227,0.1)]">
              <div
                className="h-full rounded-full bg-[var(--live)] transition-all duration-300"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Step 1 — full name */}
          <div className={step === 0 ? "" : "hidden"}>
            <label className={LABEL} htmlFor="visitorName">
              Full name *
            </label>
            <input
              id="visitorName"
              name="visitorName"
              maxLength={120}
              autoComplete="name"
              placeholder="e.g. Sarah Müller"
              onInput={() => clearError("visitorName")}
              className={`${INPUT_BASE} ${
                errors.visitorName ? INPUT_BORDER_ERR : INPUT_BORDER_OK
              }`}
            />
            <FieldError msg={errors.visitorName} />
          </div>

          {/* Step 2 — company */}
          <div className={step === 1 ? "" : "hidden"}>
            <label className={LABEL} htmlFor="visitorCompany">
              Company / organisation *
            </label>
            <input
              id="visitorCompany"
              name="visitorCompany"
              maxLength={120}
              autoComplete="organization"
              placeholder="e.g. Acme Pty Ltd"
              onInput={() => clearError("visitorCompany")}
              className={`${INPUT_BASE} ${
                errors.visitorCompany ? INPUT_BORDER_ERR : INPUT_BORDER_OK
              }`}
            />
            <FieldError msg={errors.visitorCompany} />
          </div>

          {/* Step 3 — mobile */}
          <div className={step === 2 ? "" : "hidden"}>
            <label className={LABEL} htmlFor="visitorMobile">
              Mobile *
            </label>
            <input
              id="visitorMobile"
              name="visitorMobile"
              type="tel"
              maxLength={40}
              autoComplete="tel"
              placeholder="04XX XXX XXX"
              onInput={() => clearError("visitorMobile")}
              className={`${INPUT_BASE} ${
                errors.visitorMobile ? INPUT_BORDER_ERR : INPUT_BORDER_OK
              }`}
            />
            <FieldError msg={errors.visitorMobile} />
          </div>

          {/* Step 4 — host */}
          <div className={step === 3 ? "" : "hidden"}>
            <label className={LABEL} htmlFor="visitingEmployeeId">
              Who are you visiting? *
            </label>
            <EmployeePicker
              employees={employees}
              value={employeeId}
              onChange={(id) => {
                setEmployeeId(id);
                clearError("visitingEmployeeId");
              }}
              inputClassName={`${INPUT_BASE} ${
                errors.visitingEmployeeId ? INPUT_BORDER_ERR : INPUT_BORDER_OK
              }`}
            />
            {employeeId === OTHER_HOST ? (
              <input
                name="visitingPersonOther"
                value={otherName}
                onChange={(e) => {
                  setOtherName(e.target.value);
                  clearError("visitingEmployeeId");
                }}
                maxLength={120}
                autoComplete="off"
                placeholder="Name of the person you're visiting"
                className={`${INPUT} mt-2`}
              />
            ) : null}
            <FieldError msg={errors.visitingEmployeeId} />
          </div>

          {/* Step 5 — reason */}
          <div className={step === 4 ? "" : "hidden"}>
            <label className={LABEL} htmlFor="visitReason">
              Reason for visit *
            </label>
            <input
              id="visitReason"
              name="visitReason"
              maxLength={300}
              placeholder="e.g. Delivery, meeting, maintenance"
              onInput={() => clearError("visitReason")}
              className={`${INPUT_BASE} ${
                errors.visitReason ? INPUT_BORDER_ERR : INPUT_BORDER_OK
              }`}
            />
            <FieldError msg={errors.visitReason} />
          </div>

          {/* Step 6 — tools / equipment */}
          <div className={step === 5 ? "" : "hidden"}>
            <span className={LABEL}>
              Are you bringing any tools or equipment on site? *
            </span>
            <YesNo
              name="broughtTools"
              value={broughtTools}
              invalid={!!errors.broughtTools}
              onChange={(v) => {
                setBroughtTools(v);
                clearError("broughtTools");
              }}
            />
            {broughtTools === "yes" ? (
              <input
                name="toolsDescription"
                value={toolsDescription}
                onChange={(e) => {
                  setToolsDescription(e.target.value);
                  clearError("broughtTools");
                }}
                maxLength={300}
                placeholder="Please describe the tools / equipment"
                className={`${INPUT} mt-2`}
              />
            ) : null}
            <FieldError msg={errors.broughtTools} />
          </div>

          {/* Step 7 — illness / sickness in the past 3 days */}
          <div className={step === 6 ? "" : "hidden"}>
            <span className={LABEL}>
              Have you had any illness or sickness symptoms in the past 3 days? *
            </span>
            <YesNo
              name="recentIllness"
              value={recentIllness}
              invalid={!!errors.recentIllness}
              onChange={(v) => {
                setRecentIllness(v);
                clearError("recentIllness");
              }}
            />
            {recentIllness === "yes" ? (
              <input
                name="illnessDescription"
                value={illnessDescription}
                onChange={(e) => {
                  setIllnessDescription(e.target.value);
                  clearError("recentIllness");
                }}
                maxLength={300}
                placeholder="Please describe your symptoms"
                className={`${INPUT} mt-2`}
              />
            ) : null}
            <FieldError msg={errors.recentIllness} />
          </div>

          {/* Step 8 — visitor policy agreement */}
          <div className={step === 7 ? "" : "hidden"}>
            <div
              className={`rounded-xl border bg-[rgba(244,238,227,0.05)] p-4 ${
                errors.policyAgreed
                  ? "border-[var(--danger)]"
                  : "border-[rgba(244,238,227,0.18)]"
              }`}
            >
              <p className="text-sm text-[#e6ddcf]">
                Please read our{" "}
                <button
                  type="button"
                  onClick={() => setPolicyOpen(true)}
                  className="font-semibold text-[var(--accent)] underline"
                >
                  Visitors Policy
                </button>{" "}
                before signing in.
              </p>
              <label className="mt-3 flex items-start gap-3 text-sm text-[#f4eee3]">
                <input
                  type="checkbox"
                  name="policyAgreed"
                  checked={policyAgreed}
                  onChange={(e) => {
                    setPolicyAgreed(e.target.checked);
                    clearError("policyAgreed");
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-[rgba(244,238,227,0.3)] accent-[var(--live)]"
                />
                <span>I have read and agree to the Visitors Policy. *</span>
              </label>
            </div>
            <FieldError msg={errors.policyAgreed} />
          </div>

          {/* Step 9 — signature */}
          <div className={step === 8 ? "" : "hidden"}>
            <SignaturePad
              name="signInSignature"
              label="Signature"
              required
              onInkChange={(has) => {
                setHasSignature(has);
                if (has) clearError("signInSignature");
              }}
            />
            <FieldError msg={errors.signInSignature} />
          </div>

          {/* Navigation */}
          <div className="flex gap-3 pt-1">
            {step > 0 ? (
              <button
                type="button"
                onClick={goBack}
                className="rounded-xl border border-[rgba(244,238,227,0.18)] bg-[rgba(244,238,227,0.06)] px-6 py-4 text-base font-semibold text-[#e6ddcf] transition hover:bg-[rgba(244,238,227,0.12)]"
              >
                ← Back
              </button>
            ) : null}
            <div className="flex-1">
              {step < LAST_STEP ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="w-full rounded-xl bg-[var(--live)] px-6 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-[color-mix(in_srgb,var(--live)_85%,white)]"
                >
                  Next →
                </button>
              ) : (
                <SubmitButton tone="in">Sign in</SubmitButton>
              )}
            </div>
          </div>
        </form>
      ) : (
        <form action={visitorSignOutAction} className="space-y-4">
          {signedInVisitors.length === 0 ? (
            <p className="rounded-xl border border-[rgba(244,238,227,0.13)] bg-[rgba(244,238,227,0.04)] px-4 py-6 text-center text-sm text-[#766b5e]">
              No visitors are currently signed in.
            </p>
          ) : (
            <>
              <div>
                <label className={LABEL} htmlFor="visitorNameOut">
                  Your name *
                </label>
                <SignOutNameInput
                  visitors={signedInVisitors.map((v) => ({
                    name: v.visitorName,
                    sub: `${
                      v.visitorCompany ? `${v.visitorCompany} · ` : ""
                    }visiting ${v.visitingPerson} (since ${fmtTime(
                      v.signedInAt,
                    )})`,
                  }))}
                  inputClassName={INPUT}
                />
              </div>
              <SignaturePad
                name="signOutSignature"
                label="Signature"
                required
                onInkChange={setHasSignOutSignature}
              />
              {!hasSignOutSignature ? (
                <p className="text-xs text-[#a89c8c]">
                  Please sign in the box above to enable sign-out.
                </p>
              ) : null}
              <SubmitButton tone="out" disabled={!hasSignOutSignature}>
                Sign out
              </SubmitButton>
            </>
          )}
        </form>
      )}

      {/* Visitors Policy popup — renders the PDF inline (browser viewer) so a
          kiosk tablet never leaves the page or triggers a download. */}
      {policyOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPolicyOpen(false)}
        >
          <div
            className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-[#1a1512] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 bg-[var(--accent)] px-5 py-3 text-[var(--accent-ink)]">
              <span className="font-display text-lg font-semibold">
                Visitors Policy
              </span>
              <div className="flex items-center gap-2">
                <a
                  href="/visitors-policy.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-[#17130f] px-4 py-1.5 text-sm font-medium text-[#f4eee3] transition hover:bg-[#241e19]"
                >
                  Open / Download
                </a>
                <button
                  type="button"
                  onClick={() => setPolicyOpen(false)}
                  className="rounded-full bg-[#17130f] px-4 py-1.5 text-sm font-medium text-[#f4eee3] transition hover:bg-[#241e19]"
                >
                  Close
                </button>
              </div>
            </div>
            <PdfViewer url="/visitors-policy.pdf" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
