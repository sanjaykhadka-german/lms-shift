"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  createDepartmentAction,
  updateDepartmentAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

interface Props {
  mode: "create" | "edit";
  departmentId?: string;
  defaultValues?: { name: string; description: string | null };
}

function fieldErr(state: FormState, key: string): string | null {
  if (state.status !== "error") return null;
  return state.fieldErrors?.[key]?.[0] ?? null;
}

export function DepartmentForm({ mode, departmentId, defaultValues }: Props) {
  const action =
    mode === "edit" && departmentId
      ? updateDepartmentAction.bind(null, departmentId)
      : createDepartmentAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const submitLabel = mode === "edit" ? "Save changes" : "Create department";
  const pendingLabel = mode === "edit" ? "Saving…" : "Creating…";

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaultValues?.name ?? ""}
          placeholder="e.g. Butchery"
          required
          aria-invalid={!!fieldErr(state, "name")}
        />
        {fieldErr(state, "name") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "name")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={defaultValues?.description ?? ""}
          placeholder="What does this team do?"
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
        {fieldErr(state, "description") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "description")}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        )}
        {state.status === "error" && !state.fieldErrors && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
