import type { ReactNode } from "react";

// Parallel-route host for the schedule section. The `@modal` slot renders the
// intercepted shift editor as a dialog overlaid on the grid; on a hard load
// the slot falls back to @modal/default.tsx (null) and the editor renders as
// a normal page instead.
export default function ScheduleLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
