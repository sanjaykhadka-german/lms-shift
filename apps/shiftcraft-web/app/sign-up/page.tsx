import { redirect } from "next/navigation";
import { auth } from "~/auth";
import { AuthShell } from "~/components/AuthShell";
import { SignUpForm } from "./_form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; returnTo?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/app");

  const { email, returnTo } = await searchParams;
  const safeReturnTo = returnTo && returnTo.startsWith("/") ? returnTo : undefined;

  return (
    <AuthShell
      mode="signup"
      returnTo={safeReturnTo}
      heading="Create your account"
      subheading="Sign up to start using ShiftCraft."
    >
      <SignUpForm email={email} returnTo={safeReturnTo} />
    </AuthShell>
  );
}
