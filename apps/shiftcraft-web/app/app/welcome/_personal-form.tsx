"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  selfUpdatePersonalAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

interface Defaults {
  firstName: string | null;
  lastName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  addressLine: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
}

export function PersonalForm({ defaults }: { defaults: Defaults }) {
  const [state, formAction, pending] = useActionState(
    selfUpdatePersonalAction,
    initial,
  );

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="firstName">First name</Label>
        <Input
          id="firstName"
          name="firstName"
          defaultValue={defaults.firstName ?? ""}
          placeholder="e.g. Jane"
          maxLength={60}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="lastName">Last name</Label>
        <Input
          id="lastName"
          name="lastName"
          defaultValue={defaults.lastName ?? ""}
          placeholder="e.g. Doe"
          maxLength={60}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gender">Gender</Label>
        <select
          id="gender"
          name="gender"
          defaultValue={defaults.gender ?? ""}
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="">Prefer not to say</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="non_binary">Non-binary</option>
          <option value="prefer_not_to_say">Prefer not to say</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dateOfBirth">Date of birth</Label>
        <Input
          id="dateOfBirth"
          name="dateOfBirth"
          type="date"
          defaultValue={defaults.dateOfBirth ?? ""}
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="addressLine">Residential address</Label>
        <Input
          id="addressLine"
          name="addressLine"
          defaultValue={defaults.addressLine ?? ""}
          placeholder="123 Smith St, Brunswick VIC 3056"
          maxLength={300}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="emergencyContactName">Emergency contact</Label>
        <Input
          id="emergencyContactName"
          name="emergencyContactName"
          defaultValue={defaults.emergencyContactName ?? ""}
          placeholder="Full name"
          maxLength={120}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="emergencyContactPhone">Their phone</Label>
        <Input
          id="emergencyContactPhone"
          name="emergencyContactPhone"
          type="tel"
          defaultValue={defaults.emergencyContactPhone ?? ""}
          placeholder="+61 4xx xxx xxx"
          maxLength={40}
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="emergencyContactRelationship">
          Their relationship to you
        </Label>
        <Input
          id="emergencyContactRelationship"
          name="emergencyContactRelationship"
          defaultValue={defaults.emergencyContactRelationship ?? ""}
          placeholder="e.g. Spouse, Parent, Friend"
          maxLength={60}
        />
        {state.status === "error" &&
        state.fieldErrors?.emergencyContactRelationship ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.emergencyContactRelationship[0]}
          </p>
        ) : null}
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save personal details"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        )}
        {state.status === "error" && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
