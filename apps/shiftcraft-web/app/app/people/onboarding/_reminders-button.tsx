"use client";

import { Button } from "~/components/ui/button";
import { sendOnboardingRemindersAction } from "./_actions";

// R2 — manual "remind everyone still onboarding" trigger (admin-paced, since
// ShiftCraft has no cron). Confirms before emailing.
export function OnboardingRemindersButton() {
  return (
    <form
      action={sendOnboardingRemindersAction}
      onSubmit={(e) => {
        if (
          !confirm(
            "Email an onboarding reminder to everyone still onboarding (pending or in progress)?",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Button type="submit" variant="outline" size="sm">
        Send reminders to all
      </Button>
    </form>
  );
}
