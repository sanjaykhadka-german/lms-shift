import { redirect } from "next/navigation";
import { auth } from "~/auth";
import { AuthShell } from "~/components/AuthShell";
import { SignUpForm } from "./_form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{
    email?: string;
    returnTo?: string;
    plan?: string;
    billing?: string;
  }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/app");

  const { email, returnTo, plan, billing } = await searchParams;
  // A plan from the pricing page routes the new user to workspace creation,
  // carrying the chosen plan/billing so the trial records it. An explicit
  // returnTo (e.g. an invite accept) takes precedence.
  const planParam = plan === "pro" || plan === "starter" ? plan : undefined;
  let derivedReturnTo = returnTo;
  if (!derivedReturnTo && planParam) {
    const qs = new URLSearchParams({ plan: planParam });
    if (billing === "annual" || billing === "monthly") qs.set("billing", billing);
    derivedReturnTo = `/onboarding?${qs.toString()}`;
  }
  const safeReturnTo =
    derivedReturnTo && derivedReturnTo.startsWith("/") ? derivedReturnTo : undefined;

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
