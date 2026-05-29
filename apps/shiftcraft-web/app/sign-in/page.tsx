import { redirect } from "next/navigation";
import { auth } from "~/auth";
import { AuthShell } from "~/components/AuthShell";
import { SignInForm } from "./_form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; returnTo?: string; reason?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/app");

  const { email, returnTo, reason } = await searchParams;
  const safeReturnTo = returnTo && returnTo.startsWith("/") ? returnTo : undefined;

  return (
    <AuthShell
      mode="signin"
      returnTo={safeReturnTo}
      heading="Welcome back"
      subheading="Sign in to your ShiftCraft workspace."
    >
      {reason === "revoked" && (
        <div className="rounded-[var(--r-sm)] border border-[var(--live)]/40 bg-[color-mix(in_srgb,var(--live)_12%,transparent)] px-3 py-2 text-sm text-[var(--live)]">
          Your password was changed. Please sign in again with the new password.
        </div>
      )}
      <SignInForm prefilledEmail={email} returnTo={returnTo} />
    </AuthShell>
  );
}
