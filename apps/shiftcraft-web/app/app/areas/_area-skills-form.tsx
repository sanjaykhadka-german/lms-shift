"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { setAreaSkillsAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

// Per-area required-skills picker (items 4 & 7). Checking a skill means anyone
// rostered into this area without it gets a soft "not trained for this area"
// warning on the schedule. Nothing is enforced — it's guidance for the manager.
export function AreaSkillsForm({
  areaId,
  skills,
  selectedIds,
}: {
  areaId: string;
  skills: Array<{ id: string; name: string }>;
  selectedIds: string[];
}) {
  const action = setAreaSkillsAction.bind(null, areaId);
  const [state, formAction, pending] = useActionState(action, initial);
  const selected = new Set(selectedIds);

  if (skills.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No skills defined yet.{" "}
        <a href="/app/admin/skills" className="text-primary hover:underline">
          Add skills
        </a>{" "}
        first, then come back to mark which ones this area needs.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <ul className="space-y-1.5">
        {skills.map((s) => (
          <li key={s.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="skillIds"
                value={s.id}
                defaultChecked={selected.has(s.id)}
                className="h-4 w-4 accent-[var(--accent-deep)]"
              />
              {s.name}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} size="sm">
          {pending ? "Saving…" : "Save required skills"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        )}
        {state.status === "error" && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
