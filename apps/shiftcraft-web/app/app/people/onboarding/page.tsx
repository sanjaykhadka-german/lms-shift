import { UserPlus } from "lucide-react";
import { ComingSoon } from "../_components/ComingSoon";

export const metadata = { title: "New hire onboarding · ShiftCraft" };

export default function OnboardingPage() {
  return (
    <ComingSoon
      icon={<UserPlus className="h-6 w-6" />}
      title="New hire onboarding"
      description="A guided checklist for new starters — profile completion, document signing, and training assignment — lands here in the next slice."
    />
  );
}
