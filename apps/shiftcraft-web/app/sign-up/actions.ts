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

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4100";
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
      return {
        status: "error",
        message: "An account with that email already exists. Try signing in.",
      };
    }
    return {
      status: "error",
      message: "Failed to create account. Please try again.",
    };
  }

  const params = new URLSearchParams({ email });
  if (safeReturnTo) params.set("returnTo", safeReturnTo);
  redirect(`/sign-in?${params.toString()}&sent=1`);
}
