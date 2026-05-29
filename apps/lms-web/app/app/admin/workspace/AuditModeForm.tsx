"use client";

import { useActionState, useState } from "react";
import type { AuditModeSettings } from "@tracey/db";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  updateWorkspaceAuditModeAction,
  type WorkspaceFormState,
} from "./actions";

const initial: WorkspaceFormState = { status: "idle" };

interface Props {
  current: boolean;
  settings: AuditModeSettings;
}

const SUB_TOGGLES: ReadonlyArray<{
  name: keyof AuditModeSettings;
  label: string;
  description: string;
}> = [
  {
    name: "hideUnpublishedModules",
    label: "Hide unpublished modules",
    description: "Draft modules on Modules and dashboard.",
  },
  {
    name: "hideIncompleteAssignments",
    label: "Hide incomplete assignments",
    description: "Pending rows on Assignments; KPI counts recomputed.",
  },
  {
    name: "hideFailedAttempts",
    label: "Hide failed quiz attempts",
    description:
      "Failed rows on employee detail, dashboard, and training matrix cells.",
  },
  {
    name: "hideInactiveEmployees",
    label: "Hide inactive employees from compliance",
    description:
      "Disabled or terminated staff in compliance denominators. Directory still shows them.",
  },
  {
    name: "hideExpiredWhs",
    label: "Hide expired WHS records",
    description:
      "Past-expiry certificates on WHS. Incidents and open licences stay visible.",
  },
  {
    name: "hideAuditOnlyRoutes",
    label: "Hide audit-only admin pages",
    description:
      "Sidebar links + 404 the Audit logs, Staff register, and AI Studio pages.",
  },
];

export function AuditModeForm({ current, settings }: Props) {
  const [state, formAction, pending] = useActionState(
    updateWorkspaceAuditModeAction,
    initial,
  );
  const [masterOn, setMasterOn] = useState(current);

  return (
    <form
      action={formAction}
      className="space-y-4"
      key={state.status === "ok" ? state.message : "form"}
    >
      <div className="space-y-1.5">
        <Label
          htmlFor="auditMode"
          className="flex items-center gap-3 text-sm"
        >
          <input
            id="auditMode"
            name="auditMode"
            type="checkbox"
            defaultChecked={current}
            onChange={(e) => setMasterOn(e.currentTarget.checked)}
            className="h-4 w-4 rounded border-[color:var(--border)]"
          />
          <span className="font-medium">Enable Audit Mode</span>
        </Label>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          When ON, admin and manager screens hide audit-sensitive rows based on
          the sub-toggles below. Learner-facing pages are unaffected. Every flip
          is recorded in the audit log.
        </p>
      </div>

      <fieldset
        className={`space-y-3 rounded-md border border-[color:var(--border)] p-3 transition-opacity ${
          masterOn ? "" : "opacity-60"
        }`}
      >
        <legend className="px-1 text-xs font-medium text-[color:var(--muted-foreground)]">
          {masterOn
            ? "What to hide while Audit Mode is on"
            : "Sub-toggles (only fire when Audit Mode is ON)"}
        </legend>
        {SUB_TOGGLES.map((t) => (
          <Label
            key={t.name}
            htmlFor={t.name}
            className="flex items-start gap-3 text-sm font-normal"
          >
            <input
              id={t.name}
              name={t.name}
              type="checkbox"
              defaultChecked={settings[t.name]}
              className="mt-0.5 h-4 w-4 rounded border-[color:var(--border)]"
            />
            <span className="flex-1">
              <span className="block font-medium">{t.label}</span>
              <span className="block text-xs text-[color:var(--muted-foreground)]">
                {t.description}
              </span>
            </span>
          </Label>
        ))}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-emerald-600">{state.message}</p>
        )}
        {state.status === "error" && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
