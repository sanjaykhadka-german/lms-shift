import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "~/lib/auth/current";
import { siteConfig } from "~/lib/site-config";
import { SignUpForm } from "./_form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; email?: string; returnTo?: string }>;
}) {
  if (await currentUser()) redirect("/app");

  const { plan, email, returnTo } = await searchParams;
  const safeReturnTo = returnTo && returnTo.startsWith("/") ? returnTo : undefined;
  const isInvite = !!safeReturnTo && safeReturnTo.startsWith("/accept-invite");

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            {isInvite
              ? "Set a password to accept your invitation."
              : `Start your ${siteConfig.trialDays}-day free trial. No credit card required.`}
          </p>
        </div>
        <SignUpForm plan={plan} email={email} returnTo={safeReturnTo} />
        <p className="text-center text-sm text-[color:var(--muted-foreground)]">
          Already have an account?{" "}
          <Link
            href={safeReturnTo ? `/sign-in?returnTo=${encodeURIComponent(safeReturnTo)}` : "/sign-in"}
            className="text-[color:var(--foreground)] underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
