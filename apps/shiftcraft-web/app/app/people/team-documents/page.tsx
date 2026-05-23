import { FileText } from "lucide-react";
import { ComingSoon } from "../_components/ComingSoon";

export const metadata = { title: "Team documents · ShiftCraft" };

export default function TeamDocumentsPage() {
  return (
    <ComingSoon
      icon={<FileText className="h-6 w-6" />}
      title="Team documents"
      description="Per-employee documents with expiry tracking — licences, certifications, signed contracts — will live here in the next slice."
    />
  );
}
