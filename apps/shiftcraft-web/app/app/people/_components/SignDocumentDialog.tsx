"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  signDocumentAction,
  type SignDocumentState,
} from "../documents/_actions";

const INITIAL: SignDocumentState = { status: "idle" };

interface Props {
  documentId: string;
  documentTitle: string;
  // The signer's full name as recorded on their sc_employees row — pre-
  // filled into the typed-signature input so most users just confirm.
  defaultName: string;
}

export function SignDocumentDialog({
  documentId,
  documentTitle,
  defaultName,
}: Props) {
  const [state, formAction] = useActionState(signDocumentAction, INITIAL);
  const [open, setOpen] = useState(false);

  // Close the dialog automatically on success — the page revalidation
  // inside the action will refresh the signed badge on the row.
  useEffect(() => {
    if (state.status === "ok") setOpen(false);
  }, [state.status]);

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        className="bg-[var(--warn)] hover:bg-[color-mix(in_srgb,var(--warn)_85%,black)] text-white"
      >
        Sign
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sign-dialog-title"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
            <h2 id="sign-dialog-title" className="text-base font-semibold">
              Sign &ldquo;{documentTitle}&rdquo;
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              By typing your full name below, you are signing this
              document. We will record your signature with the current
              date and time, your IP address, your browser, and a
              cryptographic hash of the document.
            </p>

            <form action={formAction} className="mt-4 space-y-3">
              <input type="hidden" name="documentId" value={documentId} />

              <label className="block text-xs">
                <span className="font-medium text-muted-foreground">
                  Type your full name
                </span>
                <input
                  type="text"
                  name="signatureText"
                  defaultValue={defaultName}
                  autoComplete="off"
                  required
                  minLength={2}
                  maxLength={200}
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 font-[ui-serif,Georgia,Cambria,serif] text-base italic focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {state.status === "error" && state.fieldErrors?.signatureText ? (
                  <span className="mt-1 block text-[color:var(--destructive)]">
                    {state.fieldErrors.signatureText[0]}
                  </span>
                ) : null}
              </label>

              {state.status === "error" && !state.fieldErrors ? (
                <p className="text-xs text-[color:var(--destructive)]">
                  {state.message}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <SubmitButton />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Signing…" : "Sign document"}
    </Button>
  );
}
