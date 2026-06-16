import Link from "next/link";
import { Button } from "~/components/ui/button";
import { EditShiftContent } from "../../_edit-content";

export const metadata = { title: "Edit shift · ShiftCraft" };

// Standalone full-page editor. Reached on a hard load / refresh of
// /app/schedule/[id]/edit, or when the @modal interception doesn't apply
// (e.g. navigating here directly). When clicked from the schedule grid the
// intercepting route at @modal/(.)[id]/edit renders the same content in a
// dialog instead.
export default async function EditShiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ offered?: string; skipped?: string; leave?: string }>;
}) {
  const { id } = await params;
  const { offered, skipped, leave } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-10">
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href="/app/schedule">← Back to schedule</Link>
        </Button>
      </div>
      <EditShiftContent
        id={id}
        offered={offered}
        skipped={skipped}
        leave={leave}
      />
    </div>
  );
}
