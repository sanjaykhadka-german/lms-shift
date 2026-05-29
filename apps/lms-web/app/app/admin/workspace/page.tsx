import { requireAdmin } from "~/lib/auth/admin";
import { formatDateTime } from "~/lib/format/datetime";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { PageHeader } from "~/components/page-header";
import { TimezoneForm } from "./TimezoneForm";
import { AuditModeForm } from "./AuditModeForm";

export const metadata = { title: "Workspace" };

function listTimezones(): string[] {
  type IntlWithZones = typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const intlWithZones = Intl as IntlWithZones;
  if (typeof intlWithZones.supportedValuesOf === "function") {
    try {
      return intlWithZones.supportedValuesOf("timeZone");
    } catch {
      // fall through to fallback
    }
  }
  return [
    "Australia/Sydney",
    "Australia/Melbourne",
    "Australia/Brisbane",
    "Australia/Adelaide",
    "Australia/Perth",
    "Pacific/Auckland",
    "UTC",
  ];
}

export default async function WorkspaceSettingsPage() {
  const ctx = await requireAdmin();
  const zones = listTimezones();
  const previewNow = formatDateTime(new Date(), ctx.tenantTimezone);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspace"
        description="Settings that apply to everyone in this workspace."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Timezone</CardTitle>
          <CardDescription>
            Currently {ctx.tenantTimezone}. Right now it&apos;s {previewNow} here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TimezoneForm current={ctx.tenantTimezone} zones={zones} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Audit Mode</CardTitle>
          <CardDescription>
            Flip this on before an external auditor (SQF, HACCP, customer)
            sits down at the screen. Hides in-progress and non-compliant
            rows from admin views — without modifying any underlying data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditModeForm
            current={ctx.tenantAuditMode}
            settings={ctx.tenantAuditSettings}
          />
        </CardContent>
      </Card>
    </div>
  );
}
