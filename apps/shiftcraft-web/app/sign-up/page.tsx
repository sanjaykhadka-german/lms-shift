import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "~/lib/auth/current";
import { SignUpForm } from "./_form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; returnTo?: string }>;
}) {
  if (await currentUser()) redirect("/app");

  const { email, returnTo } = await searchParams;
  const safeReturnTo = returnTo && returnTo.startsWith("/") ? returnTo : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm text-muted-foreground">
            Sign up to start using ShiftCraft.
          </p>
        </div>
        <SignUpForm email={email} returnTo={safeReturnTo} />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={safeReturnTo ? `/sign-in?returnTo=${encodeURIComponent(safeReturnTo)}` : "/sign-in"}
            className="text-foreground underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
