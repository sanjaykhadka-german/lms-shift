"use client";

import { updateMemberKindAction } from "../_actions";

/**
 * Inline type selector on a team-member row. Submits on change so an admin can
 * reclassify someone as Employee / Contractor / Visitor without a separate
 * save step. Backed by updateMemberKindAction (workspace-admin only, tenant
 * scoped).
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
        className="h-7 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="employee">Employee</option>
        <option value="contractor">Contractor</option>
        <option value="visitor">Visitor</option>
      </select>
    </form>
  );
}
