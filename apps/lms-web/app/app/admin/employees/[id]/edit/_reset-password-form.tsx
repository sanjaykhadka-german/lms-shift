"use client";

import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { resetEmployeePasswordAction } from "../../actions";

export function ResetPasswordForm({ id, email }: { id: number; email: string }) {
  return (
    <form
      action={resetEmployeePasswordAction}
      onSubmit={(e) => {
        if (!confirm(`Reset password for ${email}?`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      tooltip="Generate a new password and email it to the employee"
    >
      {pending ? "Resetting…" : "Reset password"}
    </Button>
  );
}
