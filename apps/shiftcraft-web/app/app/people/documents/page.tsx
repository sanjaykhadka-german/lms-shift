import { FolderOpen } from "lucide-react";
import { ComingSoon } from "../_components/ComingSoon";

export const metadata = { title: "Document library · ShiftCraft" };

export default function DocumentLibraryPage() {
  return (
    <ComingSoon
      icon={<FolderOpen className="h-6 w-6" />}
      title="Document library"
      description="Workspace-wide documents — handbook, policies, contract templates — will be uploadable and browsable here in the next slice."
    />
  );
}
