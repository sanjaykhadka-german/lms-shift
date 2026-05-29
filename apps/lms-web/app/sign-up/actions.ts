"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "~/lib/supabase/server";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long"),
  returnTo: z.string().optional(),
});

export type SignUpState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export async function signUpAction(
  _prev: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    returnTo: formData.get("returnTo") ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { name, email, password, returnTo } = parsed.data;
  const safeReturnTo = returnTo && returnTo.startsWith("/") ? returnTo : undefined;

  // Where Supabase sends the user after they click the confirmation link.
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4000";
  const callbackUrl = new URL("/auth/callback", origin);
  if (safeReturnTo) callbackUrl.searchParams.set("returnTo", safeReturnTo);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo: callbackUrl.toString(),
    },
  });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("already registered") || msg.includes("already exists")) {
      // Don't reveal whether the email is registered — show the same waiting
      // page a fresh sign-up would.
      redirect(`/verify-email?email=${encodeURIComponent(email)}&sent=1`);
    }
    return {
      status: "error",
      message: "Failed to create account. Please try again.",
    };
  }

  const sentParams = new URLSearchParams({ email, sent: "1" });
  if (safeReturnTo) sentParams.set("returnTo", safeReturnTo);
  redirect(`/verify-email?${sentParams.toString()}`);
}
