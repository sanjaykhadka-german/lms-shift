"use client";

import { useActionState, useState } from "react";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { updateAvatarAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

interface Props {
  email: string;
  name: string | null;
  currentImage: string | null;
}

function fieldErr(state: FormState, key: string): string | null {
  if (state.status !== "error") return null;
  return state.fieldErrors?.[key]?.[0] ?? null;
}

export function AvatarForm({ email, name, currentImage }: Props) {
  const [state, formAction, pending] = useActionState(
    updateAvatarAction,
    initial,
  );
  // Local preview so the user sees the new image before submitting.
  const [draft, setDraft] = useState<string>(currentImage ?? "");
  const previewImage = draft.trim().length > 0 ? draft.trim() : null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <Avatar
        email={email}
        name={name}
        image={previewImage}
        sizeClass="h-16 w-16"
        textClass="text-lg"
      />
      <form action={formAction} className="flex-1 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="avatarUrl">Image URL</Label>
          <Input
            id="avatarUrl"
            name="avatarUrl"
            type="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://example.com/me.jpg"
            inputMode="url"
            autoComplete="off"
            aria-invalid={!!fieldErr(state, "avatarUrl")}
          />
          {fieldErr(state, "avatarUrl") ? (
            <p className="text-xs text-[color:var(--destructive)]">
              {fieldErr(state, "avatarUrl")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Paste a direct image URL (https only). Leave blank to fall
              back to the coloured-initials default.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save avatar"}
          </Button>
          {currentImage && (
            <Button
              type="submit"
              variant="outline"
              onClick={() => setDraft("")}
            >
              Clear
            </Button>
          )}
          {state.status === "ok" && (
            <p className="text-xs text-[var(--live)]">{state.message}</p>
          )}
          {state.status === "error" && !state.fieldErrors && (
            <p className="text-xs text-[color:var(--destructive)]">
              {state.message}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
