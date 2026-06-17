"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { SignaturePad } from "~/components/SignaturePad";
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
  "mb-1.5 block font-mono text-xs uppercase tracking-[0.14em] text-[#a89c8c]";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SubmitButton({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "in" | "out";
}) {
  const { pending } = useFormStatus();
  const bg =
    tone === "in"
      ? "bg-[var(--live)] hover:bg-[color-mix(in_srgb,var(--live)_85%,white)]"
      : "bg-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_85%,white)]";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`mt-2 w-full rounded-xl px-6 py-4 text-base font-semibold text-white shadow-sm transition disabled:opacity-60 ${bg}`}
    >
      {pending ? "…" : children}
    </button>
  );
}

export function VisitorForm({
  signedInVisitors,
  employeeNames,
}: {
  signedInVisitors: SignedInVisitor[];
  employeeNames: string[];
}) {
  const [tab, setTab] = useState<"in" | "out">("in");
  const [selectedOut, setSelectedOut] = useState("");

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
              Company / organisation
            </label>
            <input
              id="visitorCompany"
              name="visitorCompany"
              maxLength={120}
              autoComplete="organization"
              placeholder="Optional"
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
              <label className={LABEL} htmlFor="visitingPerson">
                Who are you visiting? *
              </label>
              <input
                id="visitingPerson"
                name="visitingPerson"
                required
                maxLength={120}
                list="employee-names"
                placeholder="Name or department"
                className={INPUT}
              />
              <datalist id="employee-names">
                {employeeNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="visitReason">
              Reason for visit
            </label>
            <input
              id="visitReason"
              name="visitReason"
              maxLength={300}
              placeholder="Optional"
              className={INPUT}
            />
          </div>
          <SignaturePad name="signInSignature" label="Signature" required />
          <SubmitButton tone="in">Sign in</SubmitButton>
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
                <label className={LABEL} htmlFor="id">
                  Select visitor *
                </label>
                <select
                  id="id"
                  name="id"
                  required
                  value={selectedOut}
                  onChange={(e) => setSelectedOut(e.target.value)}
                  className={INPUT}
                >
                  <option value="">Choose a visitor…</option>
                  {signedInVisitors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.visitorName}
                      {v.visitorCompany ? ` · ${v.visitorCompany}` : ""} —
                      visiting {v.visitingPerson} (since{" "}
                      {fmtTime(v.signedInAt)})
                    </option>
                  ))}
                </select>
              </div>
              <SignaturePad name="signOutSignature" label="Signature (optional)" />
              <SubmitButton tone="out">Sign out</SubmitButton>
            </>
          )}
        </form>
      )}
    </div>
  );
}
