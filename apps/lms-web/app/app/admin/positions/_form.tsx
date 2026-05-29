"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createPositionAction } from "./actions";
import type { FormState } from "../_components/NameCrudForm";

const initial: FormState = { status: "idle" };

interface Props {
  positions: Array<{ id: number; name: string }>;
  departments: Array<{ id: number; name: string }>;
}

export function CreatePositionForm({ positions, departments }: Props) {
  const [state, formAction, pending] = useActionState(createPositionAction, initial);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. QA Manager"
          required
          aria-invalid={state.status === "error" && !!state.fieldErrors?.name}
        />
        {state.status === "error" && state.fieldErrors?.name && (
          <p className="text-xs text-[color:var(--destructive)]">{state.fieldErrors.name[0]}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="parent_id">Reports to</Label>
        <select
          id="parent_id"
          name="parent_id"
          defaultValue=""
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="">— Top-level —</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="department_id">Department</Label>
        <select
          id="department_id"
          name="department_id"
          defaultValue=""
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="">— None —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-3 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add position"}
        </Button>
        {state.status === "ok" && <p className="text-xs text-emerald-600">{state.message}</p>}
        {state.status === "error" && !state.fieldErrors && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
