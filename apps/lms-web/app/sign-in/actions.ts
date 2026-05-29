"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "~/lib/supabase/server";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password").max(200),
  returnTo: z.string().optional(),
});

export type SignInState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = schema.safeParse({
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
  const { email, password, returnTo } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("not confirmed")) {
      return {
        status: "error",
        message:
          "Please verify your email before signing in. Check your inbox for the verification link.",
      };
    }
    if (msg.includes("invalid login")) {
      return { status: "error", message: "Wrong email or password." };
    }
    return { status: "error", message: "Sign in failed. Please try again." };
  }

  // signInWithPassword set the session cookies via the server client.
  redirect(returnTo && returnTo.startsWith("/") ? returnTo : "/app");
}
