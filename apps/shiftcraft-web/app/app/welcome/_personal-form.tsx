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
  preferredName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  addressLine: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export function PersonalForm({ defaults }: { defaults: Defaults }) {
  const [state, formAction, pending] = useActionState(
    selfUpdatePersonalAction,
    initial,
  );

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="preferredName">Preferred name</Label>
        <Input
          id="preferredName"
          name="preferredName"
          defaultValue={defaults.preferredName ?? ""}
          placeholder="What people call you on the floor"
          maxLength={80}
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

      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save personal details"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-emerald-600">{state.message}</p>
        )}
        {state.status === "error" && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
