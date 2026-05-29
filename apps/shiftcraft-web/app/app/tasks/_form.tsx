"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  createTaskAction,
  updateTaskAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

interface Person {
  id: string;
  label: string;
}

interface Location {
  id: string;
  name: string;
}

interface Defaults {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeUserId: string | null;
  locationId: string | null;
  dueDate: string | null;
}

interface Props {
  mode: "create" | "edit";
  taskId?: string;
  defaultValues?: Defaults;
  assignees: Person[];
  locations: Location[];
}

function fieldErr(state: FormState, k: string): string | null {
  if (state.status !== "error") return null;
  return state.fieldErrors?.[k]?.[0] ?? null;
}

export function TaskForm({
  mode,
  taskId,
  defaultValues,
  assignees,
  locations,
}: Props) {
  const action =
    mode === "edit" && taskId
      ? updateTaskAction.bind(null, taskId)
      : createTaskAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const submitLabel = mode === "edit" ? "Save changes" : "Add task";
  const pendingLabel = mode === "edit" ? "Saving…" : "Adding…";

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          defaultValue={defaultValues?.title ?? ""}
          placeholder="e.g. Order replacement knife sharpener"
          required
          aria-invalid={!!fieldErr(state, "title")}
        />
        {fieldErr(state, "title") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "title")}
          </p>
        )}
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="description">Description (optional)</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={defaultValues?.description ?? ""}
          placeholder="Add any context, links, or steps."
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          name="status"
          defaultValue={defaultValues?.status ?? "open"}
          required
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="priority">Priority</Label>
        <select
          id="priority"
          name="priority"
          defaultValue={defaultValues?.priority ?? "normal"}
          required
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assigneeUserId">Assignee (optional)</Label>
        <select
          id="assigneeUserId"
          name="assigneeUserId"
          defaultValue={defaultValues?.assigneeUserId ?? ""}
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="">— Unassigned —</option>
          {assignees.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="locationId">Location (optional)</Label>
        <select
          id="locationId"
          name="locationId"
          defaultValue={defaultValues?.locationId ?? ""}
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="">— Any —</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="dueDate">Due date (optional)</Label>
        <Input
          id="dueDate"
          name="dueDate"
          type="date"
          defaultValue={defaultValues?.dueDate ?? ""}
          className="sm:w-56"
        />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
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
