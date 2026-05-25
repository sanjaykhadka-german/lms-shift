"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { renameSkillAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

export function RenameSkillForm({
  id,
  currentName,
}: {
  id: string;
  currentName: string;
}) {
  const [state, formAction, pending] = useActionState(renameSkillAction, initial);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input
        name="name"
        defaultValue={currentName}
        required
        maxLength={80}
        className="h-8 text-sm"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving" : "Save"}
      </Button>
      {state.status === "error" && state.fieldErrors?.name && (
        <span className="text-xs text-[color:var(--destructive)]">
          {state.fieldErrors.name[0]}
        </span>
      )}
      {state.status === "ok" && (
        <span className="text-xs text-emerald-600">Saved</span>
      )}
    </form>
  );
}
