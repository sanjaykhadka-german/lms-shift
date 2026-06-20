"use client";

import { Button } from "~/components/ui/button";
import { sendApprovalDigestAction } from "./digest-actions";

// R1 Features 3+4 — admin button that emails managers a timesheet-approval
// digest (and flags weeks pending >7 days). Manual trigger on the admin's own
// cadence; mirrors the WHS-reminder button pattern.
export function ApprovalDigestButton() {
  return (
    <form
      action={sendApprovalDigestAction}
      onSubmit={(e) => {
        if (
          !confirm(
            "Email all managers a summary of timesheets awaiting approval (overdue weeks flagged)?",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Button type="submit" variant="outline" size="sm">
        Email managers a summary
      </Button>
    </form>
  );
}
