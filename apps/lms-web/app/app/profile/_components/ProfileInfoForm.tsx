"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { updateProfileAction, type ProfileFormState } from "../actions";

const initial: ProfileFormState = { status: "idle" };

export function ProfileInfoForm({
  firstName,
  lastName,
  email,
  phone,
  photoUrl,
  role,
  department,
  employer,
}: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photoUrl: string | null;
  role: string;
  department: string | null;
  employer: string | null;
}) {
  const [state, formAction] = useActionState(updateProfileAction, initial);
  const [previewUrl, setPreviewUrl] = useState<string | null>(photoUrl);
  const [removeChecked, setRemoveChecked] = useState(false);

  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "?";

  return (
    <form action={formAction} className="space-y-5">
      <Banner state={state} />

      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color:var(--secondary)] text-xl font-semibold">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span>{initials}</span>
          )}
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="photo">Profile photo</Label>
          <input
            id="photo"
            name="photo"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-[color:var(--border)] file:bg-[color:var(--secondary)] file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:opacity-90"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setPreviewUrl(URL.createObjectURL(f));
                setRemoveChecked(false);
              }
            }}
          />
          {photoUrl && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="remove_photo"
                value="1"
                checked={removeChecked}
                onChange={(e) => {
                  setRemoveChecked(e.target.checked);
                  if (e.target.checked) setPreviewUrl(null);
                  else setPreviewUrl(photoUrl);
                }}
              />
              Remove photo
            </label>
          )}
          <FieldError errors={state.fieldErrors?.photo} />
          <p className="text-xs text-[color:var(--muted-foreground)]">
            JPEG, PNG, WebP, or GIF. Max 8 MB.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="first_name">First name</Label>
          <Input
            id="first_name"
            name="first_name"
            defaultValue={firstName}
            required
            maxLength={100}
          />
          <FieldError errors={state.fieldErrors?.firstName} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="last_name">Last name</Label>
          <Input
            id="last_name"
            name="last_name"
            defaultValue={lastName}
            required
            maxLength={100}
          />
          <FieldError errors={state.fieldErrors?.lastName} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" defaultValue={email} disabled />
          <p className="text-xs text-[color:var(--muted-foreground)]">
            Contact your admin to change your email.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" defaultValue={phone} maxLength={32} />
          <FieldError errors={state.fieldErrors?.phone} />
        </div>
      </div>

      <SubmitButton />

      <div className="border-t border-[color:var(--border)] pt-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
          Admin-managed
        </div>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <ReadOnly label="Role" value={role} />
          <ReadOnly label="Department" value={department ?? "—"} />
          <ReadOnly label="Employer" value={employer ?? "—"} />
        </dl>
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[color:var(--muted-foreground)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-red-600 dark:text-red-400">{errors[0]}</p>;
}

function Banner({ state }: { state: ProfileFormState }) {
  if (state.status === "ok") {
    return (
      <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-3 py-2 text-sm dark:bg-emerald-900/10">
        {state.message ?? "Saved."}
      </div>
    );
  }
  if (state.status === "error" && state.message) {
    return (
      <div className="rounded-md border border-red-500 bg-red-50/50 px-3 py-2 text-sm dark:bg-red-900/10">
        {state.message}
      </div>
    );
  }
  return null;
}
