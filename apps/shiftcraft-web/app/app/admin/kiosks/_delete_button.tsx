"use client";

import { useFormStatus } from "react-dom";
import { deleteKioskAction } from "./actions";

// Wraps deleteKioskAction with a browser confirm() so the operator can't
// one-click-wipe a kiosk. The form-level `onSubmit` intercepts the submit
// event BEFORE the server action fires — if the user cancels the confirm,
// preventDefault stops the form submission entirely.
export function DeleteKioskButton({
  deviceId,
  label,
  variant = "row",
}: {
  deviceId: string;
  label: string;
  /** "row" for the small inline button on the list, "detail" for the
   * larger button on the per-device page. */
  variant?: "row" | "detail";
}) {
  return (
    <form
      action={deleteKioskAction}
      onSubmit={(e) => {
        const ok = window.confirm(
          `Permanently delete the kiosk "${label}"?\n\n` +
            `The row is removed from the database. Past punches stay intact ` +
            `in timesheets, but the device's audit page will no longer ` +
            `resolve. This can't be undone.`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="deviceId" value={deviceId} />
      <Submit variant={variant} />
    </form>
  );
}

function Submit({ variant }: { variant: "row" | "detail" }) {
  const { pending } = useFormStatus();
  // Solid red so the difference between "Revoke" (orange-ish destructive
  // outline) and "Delete permanently" (clearly final) is obvious. The
  // confirm dialog handles the safety; styling makes the gravity readable
  // at a glance.
  const base =
    "rounded-md bg-[var(--danger)] text-white font-medium hover:bg-[color-mix(in_srgb,var(--danger)_85%,black)] disabled:opacity-50";
  const sizing = variant === "row" ? "px-3 py-1.5 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${base} ${sizing}`}
    >
      {pending ? "Deleting…" : "Delete permanently"}
    </button>
  );
}
