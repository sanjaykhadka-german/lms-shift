"use client";

import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";

export function RevokeInvitationButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      className="text-[color:var(--destructive)] border-[color:var(--destructive)]/40 hover:bg-[color:var(--destructive)]/10"
    >
      {pending ? "…" : "Revoke"}
    </Button>
  );
}
