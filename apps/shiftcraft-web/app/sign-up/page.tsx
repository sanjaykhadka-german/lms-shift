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
    workspace?: string;
  }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/app");

  const { email, returnTo, plan, billing, workspace } = await searchParams;
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

  // When reached via an invite accept, the user is creating a login to join an
  // existing workspace — name it if we have it, so it never reads as "start your
  // own workspace". The owner/pricing funnel keeps the generic ShiftCraft copy.
  const isInvite = !!safeReturnTo && safeReturnTo.startsWith("/accept-invite");
  const subheading = isInvite
    ? workspace
      ? `Create your login to join ${workspace}.`
      : "Create your login to accept your invitation."
    : "Sign up to start using ShiftCraft.";

  return (
    <AuthShell
      mode="signup"
      returnTo={safeReturnTo}
      heading="Create your account"
      subheading={subheading}
    >
      <SignUpForm email={email} returnTo={safeReturnTo} />
    </AuthShell>
  );
}
