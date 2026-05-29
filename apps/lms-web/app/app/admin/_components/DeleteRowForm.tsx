"use client";

import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";

interface DeleteRowFormProps {
  action: (formData: FormData) => Promise<void>;
  id: number | string;
  confirmMessage: string;
  label?: string;
  tooltip?: string;
}

/** Inline single-button delete form. Browser confirm() prompt before submit. */
export function DeleteRowForm({ action, id, confirmMessage, label = "Delete", tooltip }: DeleteRowFormProps) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(confirmMessage)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={String(id)} />
      <DeleteButton label={label} tooltip={tooltip} />
    </form>
  );
}

function DeleteButton({ label, tooltip }: { label: string; tooltip?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending} tooltip={tooltip}>
      {pending ? "…" : label}
    </Button>
  );
}
