"use client";

import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";

export function RevokeButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      tooltip="Revoke this pending invitation"
    >
      {pending ? "…" : "Revoke"}
    </Button>
  );
}
