import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "~/lib/auth/current";
import { SignInForm } from "./_form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; returnTo?: string; reason?: string }>;
}) {
  if (await currentUser()) redirect("/app");

  const { email, returnTo, reason } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">Welcome back to ShiftCraft.</p>
        </div>
        {reason === "revoked" && (
          <div className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-800">
            Your password was changed. Please sign in again with the new password.
          </div>
        )}
        <SignInForm prefilledEmail={email} returnTo={returnTo} />
        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/sign-up" className="text-foreground underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
