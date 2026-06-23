"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { SignaturePad } from "~/components/SignaturePad";
import { EmployeePicker } from "./_employee_picker";
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
          <SignaturePad
            name="signInSignature"
            label="Signature"
            required
            onInkChange={setHasSignature}
          />
          {!employeeId || !hasSignature ? (
            <p className="text-xs text-[#a89c8c]">
              {!employeeId
                ? "Choose who you're visiting, then sign in the box above."
                : "Please sign in the box above to enable sign-in."}
            </p>
          ) : null}
          <SubmitButton tone="in" disabled={!employeeId || !hasSignature}>
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
    </div>
  );
}
