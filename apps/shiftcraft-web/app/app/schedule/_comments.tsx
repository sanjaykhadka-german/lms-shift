"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Avatar } from "~/components/Avatar";
import { fmtDayMonth } from "~/lib/date-format";
import {
  postShiftCommentAction,
  type CommentFormState,
} from "./comment-actions";

const initial: CommentFormState = { status: "idle" };

function relativeTime(d: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - d.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDayMonth(d);
}

export interface ShiftComment {
  id: string;
  body: string;
  createdAt: Date;
  authorUserId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  authorImage: string | null;
}

interface Props {
  shiftId: string;
  currentUserId: string;
  isAdmin: boolean;
  comments: ShiftComment[];
  /** Server action bound at the page level — keeps this island a generic
   * comments renderer without knowing the action's identity. */
  onDelete: (formData: FormData) => Promise<void>;
}

export function ShiftComments({
  shiftId,
  currentUserId,
  isAdmin,
  comments,
  onDelete,
}: Props) {
  const [state, formAction, pending] = useActionState(
    postShiftCommentAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement | null>(null);
  // Clear the textarea on a successful submit so a second comment
  // doesn't accidentally include the previous one.
  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state.status]);

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No comments yet. Use the box below to leave an internal note for
          whoever covers this shift — the employee never sees these.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const canDelete =
              isAdmin || c.authorUserId === currentUserId;
            const displayName = c.authorName ?? c.authorEmail ?? "Unknown";
            return (
              <li key={c.id} className="flex gap-3">
                <Avatar
                  name={c.authorName}
                  email={c.authorEmail ?? ""}
                  image={c.authorImage}
                  sizeClass="h-8 w-8"
                  textClass="text-[10px]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{displayName}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {relativeTime(c.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm">
                    {c.body}
                  </p>
                  {canDelete && (
                    <form action={onDelete} className="mt-1">
                      <input type="hidden" name="id" value={c.id} />
                      <input
                        type="hidden"
                        name="shiftId"
                        value={shiftId}
                      />
                      <button
                        type="submit"
                        className="text-[10px] text-muted-foreground hover:text-[color:var(--destructive)] underline-offset-2 hover:underline"
                      >
                        Delete
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form ref={formRef} action={formAction} className="space-y-2">
        <input type="hidden" name="shiftId" value={shiftId} />
        <textarea
          name="body"
          rows={2}
          maxLength={2000}
          placeholder="Add an internal note for supervisors…"
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={pending} size="sm">
            {pending ? "Posting…" : "Post comment"}
          </Button>
          {state.status === "error" && (
            <p className="text-xs text-[color:var(--destructive)]">
              {state.message}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
