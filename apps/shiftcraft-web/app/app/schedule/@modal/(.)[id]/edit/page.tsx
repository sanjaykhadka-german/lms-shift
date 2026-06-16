import { ShiftModal } from "../../../_shift-modal";
import { EditShiftContent } from "../../../_edit-content";

// Intercepts client navigations from the schedule grid to
// /app/schedule/[id]/edit and renders the full editor inside a dialog. A hard
// load of the same URL bypasses this (default.tsx renders null and the
// standalone page handles it).
export default async function InterceptedEditModal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ offered?: string; skipped?: string; leave?: string }>;
}) {
  const { id } = await params;
  const { offered, skipped, leave } = await searchParams;
  return (
    <ShiftModal>
      <EditShiftContent
        id={id}
        offered={offered}
        skipped={skipped}
        leave={leave}
      />
    </ShiftModal>
  );
}
