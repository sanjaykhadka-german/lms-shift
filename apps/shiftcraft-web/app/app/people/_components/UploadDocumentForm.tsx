"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  uploadDocumentAction,
  type UploadDocumentState,
} from "../documents/_actions";

const INITIAL: UploadDocumentState = { status: "idle" };

type EmployeeOption = { id: string; label: string };

export function UploadDocumentForm({
  scope,
  employees,
}: {
  scope: "library" | "team";
  employees?: EmployeeOption[];
}) {
  const [state, formAction] = useActionState(uploadDocumentAction, INITIAL);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="scope" value={scope} />

      <Field
        label="Title"
        name="title"
        type="text"
        required
        placeholder={
          scope === "library"
            ? "Employee handbook"
            : "Forklift licence"
        }
        error={state.status === "error" ? state.fieldErrors?.title?.[0] : undefined}
      />

      {scope === "team" && employees ? (
        <>
          <div className="space-y-1.5">
            <label
              htmlFor="upload-employee"
              className="block text-xs font-medium text-muted-foreground"
            >
              Employee
            </label>
            <select
              id="upload-employee"
              name="employeeId"
              required
              defaultValue=""
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="" disabled>
                Choose an employee…
              </option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            {state.status === "error" && state.fieldErrors?.employeeId ? (
              <p className="text-xs text-[color:var(--destructive)]">
                {state.fieldErrors.employeeId[0]}
              </p>
            ) : null}
          </div>
          <Field
            label="Expires (optional)"
            name="expiresAt"
            type="date"
            error={
              state.status === "error" ? state.fieldErrors?.expiresAt?.[0] : undefined
            }
          />
        </>
      ) : null}

      <div className="space-y-1.5">
        <label
          htmlFor="upload-notes"
          className="block text-xs font-medium text-muted-foreground"
        >
          Notes (optional)
        </label>
        <textarea
          id="upload-notes"
          name="notes"
          rows={2}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="upload-file"
          className="block text-xs font-medium text-muted-foreground"
        >
          File · max 5 MB · PDF / JPG / PNG / DOC / DOCX / TXT
        </label>
        <input
          id="upload-file"
          name="file"
          type="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
        />
        {state.status === "error" && state.fieldErrors?.file ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.file[0]}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {state.status === "ok" ? (
          <p className="text-xs text-emerald-600">{state.message}</p>
        ) : null}
        {state.status === "error" && !state.fieldErrors ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  required,
  placeholder,
  error,
}: {
  label: string;
  name: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={`upload-${name}`}
        className="block text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      <input
        id={`upload-${name}`}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        aria-invalid={!!error}
        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {error ? (
        <p className="text-xs text-[color:var(--destructive)]">{error}</p>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Uploading…" : "Upload"}
    </Button>
  );
}
