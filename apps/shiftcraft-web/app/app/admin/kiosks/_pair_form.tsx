"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { pairKioskAction, type PairFormState } from "./actions";
import { Button } from "~/components/ui/button";

interface PairFormProps {
  locations: Array<{ id: string; name: string }>;
  defaultLocationId: string | null;
}

const INITIAL: PairFormState = { status: "idle" };

export function PairKioskForm({ locations, defaultLocationId }: PairFormProps) {
  const [state, formAction] = useActionState(pairKioskAction, INITIAL);
  const router = useRouter();

  // On success the action returns the new device id; we route to a
  // ?paired=<id> URL so the server page can render the pairing-code
  // dialog. Router.replace (not push) so the back button doesn't lead
  // to the form repost.
  useEffect(() => {
    if (state.status === "ok") {
      router.replace(`/app/admin/kiosks?paired=${state.deviceId}`);
    }
  }, [state, router]);

  if (locations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add a location first before pairing a kiosk.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Label</span>
          <input
            type="text"
            name="label"
            required
            placeholder="Front counter iPad"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Location</span>
          <select
            name="locationId"
            required
            defaultValue={defaultLocationId ?? ""}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="" disabled>
              Pick a location…
            </option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          name="requireSelfie"
          defaultChecked
          className="h-4 w-4 rounded border-border"
        />
        <span>
          Require selfie on clock-in / clock-out (uncheck for kiosks on
          webcam-less devices)
        </span>
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          name="allowVisitors"
          className="h-4 w-4 rounded border-border"
        />
        <span>
          Allow visitor sign-in on this kiosk (adds a “Visitor? Sign in here”
          option for reception logbook use)
        </span>
      </label>
      {state.status === "error" ? (
        <p className="text-xs text-[color:var(--destructive)]">
          {state.message}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Pairing…" : "Generate pairing code"}
    </Button>
  );
}
