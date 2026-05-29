"use client";

import { useActionState, useState } from "react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { fmtShortDateTime } from "~/lib/date-format";
import {
  initiateCoverAction,
  initiateSwapAction,
  type FormState,
} from "./swap-actions";

const idle: FormState = { status: "idle" };

interface Teammate {
  id: string;
  name: string | null;
  email: string;
}

interface TeammateShift {
  assignmentId: string;
  userId: string;
  startsAt: string; // ISO — keep client-safe
  endsAt: string;
  role: string;
  locationName: string | null;
}

interface Props {
  assignmentId: string;
  teammates: Teammate[];
  teammateShifts: TeammateShift[];
}

type Mode = "none" | "cover" | "swap";

export function SwapForms({ assignmentId, teammates, teammateShifts }: Props) {
  const [mode, setMode] = useState<Mode>("none");

  if (teammates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No teammates yet — invite someone to enable swaps.
      </p>
    );
  }

  if (mode === "none") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setMode("cover")}>
          Request cover
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("swap")}>
          Propose swap
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {mode === "cover" ? "Request cover" : "Propose swap"}
        </span>
        <button
          type="button"
          onClick={() => setMode("none")}
          className="text-xs text-muted-foreground hover:underline"
        >
          Cancel
        </button>
      </div>
      {mode === "cover" ? (
        <CoverForm assignmentId={assignmentId} teammates={teammates} />
      ) : (
        <SwapForm
          assignmentId={assignmentId}
          teammates={teammates}
          teammateShifts={teammateShifts}
        />
      )}
    </div>
  );
}

function CoverForm({
  assignmentId,
  teammates,
}: {
  assignmentId: string;
  teammates: Teammate[];
}) {
  const [state, action, pending] = useActionState(initiateCoverAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div>
        <Label htmlFor={`cover-target-${assignmentId}`}>Ask…</Label>
        <select
          id={`cover-target-${assignmentId}`}
          name="targetUserId"
          defaultValue=""
          required
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="" disabled>
            — Choose teammate —
          </option>
          {teammates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name ?? t.email}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor={`cover-note-${assignmentId}`}>Note (optional)</Label>
        <textarea
          id={`cover-note-${assignmentId}`}
          name="note"
          rows={2}
          maxLength={500}
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
      </div>
      <FormFooter state={state} pending={pending} cta="Send request" />
    </form>
  );
}

function SwapForm({
  assignmentId,
  teammates,
  teammateShifts,
}: {
  assignmentId: string;
  teammates: Teammate[];
  teammateShifts: TeammateShift[];
}) {
  const [targetUserId, setTargetUserId] = useState("");
  const [state, action, pending] = useActionState(initiateSwapAction, idle);
  const eligible = teammateShifts.filter((s) => s.userId === targetUserId);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div>
        <Label htmlFor={`swap-target-${assignmentId}`}>Swap with…</Label>
        <select
          id={`swap-target-${assignmentId}`}
          name="targetUserId"
          value={targetUserId}
          onChange={(e) => setTargetUserId(e.target.value)}
          required
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="" disabled>
            — Choose teammate —
          </option>
          {teammates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name ?? t.email}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor={`swap-shift-${assignmentId}`}>Take their shift</Label>
        <select
          id={`swap-shift-${assignmentId}`}
          name="targetAssignmentId"
          defaultValue=""
          required
          disabled={!targetUserId || eligible.length === 0}
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)] disabled:opacity-50"
        >
          <option value="" disabled>
            {!targetUserId
              ? "— Pick a teammate first —"
              : eligible.length === 0
                ? "— They have no upcoming accepted shifts —"
                : "— Choose a shift —"}
          </option>
          {eligible.map((s) => (
            <option key={s.assignmentId} value={s.assignmentId}>
              {fmt(s.startsAt)} · {s.role}
              {s.locationName ? ` @ ${s.locationName}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor={`swap-note-${assignmentId}`}>Note (optional)</Label>
        <textarea
          id={`swap-note-${assignmentId}`}
          name="note"
          rows={2}
          maxLength={500}
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
      </div>
      <FormFooter state={state} pending={pending} cta="Send proposal" />
    </form>
  );
}

function FormFooter({
  state,
  pending,
  cta,
}: {
  state: FormState;
  pending: boolean;
  cta: string;
}) {
  return (
    <div className="space-y-1">
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Sending…" : cta}
      </Button>
      {state.status === "ok" && (
        <p className="text-xs text-[var(--live)]">{state.message}</p>
      )}
      {state.status === "error" && (
        <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
      )}
    </div>
  );
}

function fmt(iso: string): string {
  return fmtShortDateTime(new Date(iso));
}
