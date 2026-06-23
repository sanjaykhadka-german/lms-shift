"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { SignaturePad } from "~/components/SignaturePad";
import { EmployeePicker } from "./_employee_picker";
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

const INPUT =
  "h-12 w-full rounded-xl border border-[rgba(244,238,227,0.18)] bg-[rgba(244,238,227,0.05)] px-4 text-base text-[#f4eee3] placeholder:text-[#766b5e] focus:outline-none focus:ring-2 focus:ring-[rgba(244,238,227,0.25)]";
const LABEL =
  "mb-1.5 block font-mono text-xs font-medium uppercase tracking-[0.14em] text-[#e6ddcf]";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Two-button No/Yes toggle. Mirrors the in/out tab styling. Writes the chosen
// value into a hidden input so it submits with the form action.
function YesNo({
  name,
  value,
  onChange,
}: {
  name: string;
  value: "" | "yes" | "no";
  onChange: (v: "yes" | "no") => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["no", "yes"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-xl px-4 py-3 text-sm font-semibold capitalize transition ${
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
      className={`mt-2 w-full rounded-xl px-6 py-4 text-base font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${bg}`}
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
  // Gate the sign-in button on the two inputs that can't use native `required`
  // (the signature canvas + the custom employee picker both write to hidden
  // inputs). An empty signature was the most common cause of the bounce.
  const [hasSignature, setHasSignature] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  // Sign-out signature is now mandatory too — gate the sign-out button on it.
  const [hasSignOutSignature, setHasSignOutSignature] = useState(false);
  // Visitor-policy screening (POL 1.4.1.2). Both toggles must be answered; a
  // description is required when "yes"; the policy must be agreed to sign in.
  const [broughtTools, setBroughtTools] = useState<"" | "yes" | "no">("");
  const [toolsDescription, setToolsDescription] = useState("");
  const [recentIllness, setRecentIllness] = useState<"" | "yes" | "no">("");
  const [illnessDescription, setIllnessDescription] = useState("");
  const [policyAgreed, setPolicyAgreed] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  const screeningIncomplete =
    !policyAgreed ||
    broughtTools === "" ||
    recentIllness === "" ||
    (broughtTools === "yes" && !toolsDescription.trim()) ||
    (recentIllness === "yes" && !illnessDescription.trim());

  return (
    <div className="space-y-6">
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
        <form action={visitorSignInAction} className="space-y-4">
          <div>
            <label className={LABEL} htmlFor="visitorName">
              Full name *
            </label>
            <input
              id="visitorName"
              name="visitorName"
              required
              maxLength={120}
              autoComplete="name"
              placeholder="e.g. Sarah Müller"
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="visitorCompany">
              Company / organisation *
            </label>
            <input
              id="visitorCompany"
              name="visitorCompany"
              required
              maxLength={120}
              autoComplete="organization"
              placeholder="e.g. Acme Pty Ltd"
              className={INPUT}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="visitorMobile">
                Mobile *
              </label>
              <input
                id="visitorMobile"
                name="visitorMobile"
                type="tel"
                required
                maxLength={40}
                autoComplete="tel"
                placeholder="04XX XXX XXX"
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="visitingEmployeeId">
                Who are you visiting? *
              </label>
              <EmployeePicker
                employees={employees}
                value={employeeId}
                onChange={setEmployeeId}
                inputClassName={INPUT}
              />
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="visitReason">
              Reason for visit *
            </label>
            <input
              id="visitReason"
              name="visitReason"
              required
              maxLength={300}
              placeholder="e.g. Delivery, meeting, maintenance"
              className={INPUT}
            />
          </div>

          {/* Tools / equipment */}
          <div>
            <span className={LABEL}>
              Are you bringing any tools or equipment on site? *
            </span>
            <YesNo
              name="broughtTools"
              value={broughtTools}
              onChange={setBroughtTools}
            />
            {broughtTools === "yes" ? (
              <input
                name="toolsDescription"
                value={toolsDescription}
                onChange={(e) => setToolsDescription(e.target.value)}
                maxLength={300}
                placeholder="Please describe the tools / equipment"
                className={`${INPUT} mt-2`}
              />
            ) : null}
          </div>

          {/* Illness / sickness in the past 3 days */}
          <div>
            <span className={LABEL}>
              Have you had any illness or sickness symptoms in the past 3 days? *
            </span>
            <YesNo
              name="recentIllness"
              value={recentIllness}
              onChange={setRecentIllness}
            />
            {recentIllness === "yes" ? (
              <input
                name="illnessDescription"
                value={illnessDescription}
                onChange={(e) => setIllnessDescription(e.target.value)}
                maxLength={300}
                placeholder="Please describe your symptoms"
                className={`${INPUT} mt-2`}
              />
            ) : null}
          </div>

          {/* Visitor policy agreement */}
          <div className="rounded-xl border border-[rgba(244,238,227,0.18)] bg-[rgba(244,238,227,0.05)] p-4">
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
                onChange={(e) => setPolicyAgreed(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-[rgba(244,238,227,0.3)] accent-[var(--live)]"
              />
              <span>
                I have read and agree to the Visitors Policy. *
              </span>
            </label>
          </div>

          <SignaturePad
            name="signInSignature"
            label="Signature"
            required
            onInkChange={setHasSignature}
          />
          {!employeeId || !hasSignature || screeningIncomplete ? (
            <p className="text-xs text-[#a89c8c]">
              {!employeeId
                ? "Choose who you're visiting, then complete the questions and sign."
                : screeningIncomplete
                  ? "Answer the questions above, agree to the policy, then sign."
                  : "Please sign in the box above to enable sign-in."}
            </p>
          ) : null}
          <SubmitButton
            tone="in"
            disabled={!employeeId || !hasSignature || screeningIncomplete}
          >
            Sign in
          </SubmitButton>
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
