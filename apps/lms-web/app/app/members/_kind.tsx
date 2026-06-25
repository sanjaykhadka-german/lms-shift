"use client";

import { updateMemberKindAction } from "./actions";

/**
 * Inline type selector on a member row. Submits on change. Backed by
 * updateMemberKindAction (owner/admin only, tenant scoped). The `kind` is
 * shared across apps, so changing it here also moves the person between the
 * Employees / Contractors / Visitors sections in ShiftCraft.
 */
export function MemberKindSelect({
  memberId,
  kind,
}: {
  memberId: string;
  kind: string;
}) {
  return (
    <form action={updateMemberKindAction}>
      <input type="hidden" name="memberId" value={memberId} />
      <select
        name="kind"
        defaultValue={kind}
        aria-label="Member type"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
      >
        <option value="employee">Employee</option>
        <option value="contractor">Contractor</option>
        <option value="visitor">Visitor</option>
      </select>
    </form>
  );
}
