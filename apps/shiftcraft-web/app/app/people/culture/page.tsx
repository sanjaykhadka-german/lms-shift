import { Heart } from "lucide-react";
import { ComingSoon } from "../_components/ComingSoon";

export const metadata = { title: "Culture · ShiftCraft" };

export default function CulturePage() {
  return (
    <ComingSoon
      icon={<Heart className="h-6 w-6" />}
      title="Culture"
      description="Engagement and recognition features (kudos, shout-outs, pulse surveys) are on the roadmap and will land here."
    />
  );
}
