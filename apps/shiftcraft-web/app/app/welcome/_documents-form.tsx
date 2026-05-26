"use client";

import { useActionState, useRef, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  selfUploadDocumentAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

export function DocumentUploadForm() {
  const [state, formAction, pending] = useActionState(
    selfUploadDocumentAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid gap-3 sm:grid-cols-2"
    >
      <div className="space-y-1.5">
        <Label htmlFor="title">Document title</Label>
        <Input
          id="title"
          name="title"
          placeholder="e.g. RSA certificate, Drivers licence"
          required
          maxLength={200}
        />
        {state.status === "error" && state.fieldErrors?.title && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.title[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Note (optional)</Label>
        <Input
          id="notes"
          name="notes"
          placeholder="Expiry date, reference number, etc."
          maxLength={2000}
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="file">File (PDF / image / Word, max 5 MiB)</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          required
        />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload document"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-emerald-600">{state.message}</p>
        )}
        {state.status === "error" && !state.fieldErrors && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
