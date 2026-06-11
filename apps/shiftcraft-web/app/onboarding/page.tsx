import { redirect } from "next/navigation";
import { requireUser, currentMembership } from "~/lib/auth/current";
import { OnboardingForm } from "./_form";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; billing?: string }>;
}) {
  await requireUser();
  // If they already have a membership, /app is the right place.
  const existing = await currentMembership();
  if (existing) redirect("/app");

  // Carried from the pricing page through sign-up → sign-in → here, so the
  // new workspace's trial records the plan they picked.
  const { plan } = await searchParams;
  const trialPlan =
    plan === "pro" || plan === "starter" ? plan : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create your ShiftCraft workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            One workspace per company. You&rsquo;ll be able to invite your team,
            build rosters, and run the time clock once it&rsquo;s set up.
          </p>
        </div>
        <OnboardingForm plan={trialPlan} />
      </div>
    </div>
  );
}
