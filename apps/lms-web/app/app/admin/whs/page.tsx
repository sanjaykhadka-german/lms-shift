import Link from "next/link";
import { requireAdmin } from "~/lib/auth/admin";
import { listAdminWhsRecords } from "~/lib/lms/queries/whs";
import { ensureSystemKinds, listWhsKinds } from "~/lib/lms/whs-kinds";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { HelpPopover } from "~/components/ui/help-popover";
import { DeleteRowForm } from "../_components/DeleteRowForm";
import { WhsReminderButton } from "../_components/ReminderButtons";
import { deleteWhsRecordAction } from "./actions";

export const metadata = { title: "WHS register" };

const SEVERITY_VARIANT: Record<string, "secondary" | "warning" | "destructive"> = {
  low: "secondary",
  medium: "warning",
  high: "destructive",
  critical: "destructive",
};

export default async function WhsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; ok?: string; whs_reminders?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  await ensureSystemKinds({ db: ctx.db, traceyTenantId: tid });

  const kindRows = await listWhsKinds({ db: ctx.db, traceyTenantId: tid });
  const kindBySlug = new Map(kindRows.map((k) => [k.slug, k]));

  const kindFilter = sp.kind && kindBySlug.has(sp.kind) ? sp.kind : undefined;
  const records = await listAdminWhsRecords(ctx, { kindFilter });

  const today = new Date();
  const soonMs = 30 * 24 * 60 * 60 * 1000;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
            WHS register
            <HelpPopover label="About the WHS register">
              Work Health &amp; Safety records — high-risk licences (forklift,
              first-aid certificates), nominated fire wardens / first aiders,
              and incident reports. Each record belongs to a <em>kind</em>{" "}
              (manage them via the button on the right). Expiry-style records
              get an expiry date and trigger reminder emails; incident-style
              records get a severity and reporter field.
            </HelpPopover>
          </h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            High-risk licences, fire wardens, first aiders, and incident reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WhsReminderButton />
          <Button asChild variant="outline" tooltip="Manage the list of WHS record types">
            <Link href="/app/admin/whs/kinds">Manage kinds</Link>
          </Button>
          <Button asChild tooltip="Add a new WHS record for an employee">
            <Link href="/app/admin/whs/new">Add record</Link>
          </Button>
        </div>
      </div>

      {sp.ok && (
        <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-2 text-sm dark:bg-emerald-900/10">
          Record {sp.ok}.
        </div>
      )}

      {sp.whs_reminders !== undefined && (
        <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-2 text-sm dark:bg-emerald-900/10">
          {sp.whs_reminders === "0"
            ? "No reminders due — nothing sent."
            : `Sent ${sp.whs_reminders} WHS reminder email${sp.whs_reminders === "1" ? "" : "s"}.`}
        </div>
      )}

      <nav className="flex flex-wrap gap-2 text-xs">
        <KindLink current={sp.kind} kind={null} label="All" />
        {kindRows.map((k) => (
          <KindLink key={k.slug} current={sp.kind} kind={k.slug} label={k.label} />
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Records ({records.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-6 py-2">Title</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Expires</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Document</th>
                  <th className="px-6 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-6 text-center text-[color:var(--muted-foreground)]">
                      No WHS records yet.
                    </td>
                  </tr>
                ) : (
                  records.map((r) => {
                    const kind = kindBySlug.get(r.kind);
                    const isIncident = kind?.category === "incident";
                    const exp = r.expiresOn ? new Date(r.expiresOn) : null;
                    const expSoon = exp && exp.getTime() < today.getTime() + soonMs;
                    const expired = exp && exp.getTime() < today.getTime();
                    return (
                      <tr key={r.id}>
                        <td className="px-6 py-3 align-middle">
                          <Link href={`/app/admin/whs/${r.id}/edit`} className="font-medium hover:underline">
                            {r.title}
                          </Link>
                        </td>
                        <td className="px-3 py-3 align-middle">{kind?.label ?? r.kind}</td>
                        <td className="px-3 py-3 align-middle">{r.userName ?? "—"}</td>
                        <td className="px-3 py-3 align-middle">
                          {r.expiresOn ?? (isIncident ? "—" : "")}
                          {expired && <Badge className="ml-2" variant="destructive">Expired</Badge>}
                          {!expired && expSoon && <Badge className="ml-2" variant="warning">Soon</Badge>}
                        </td>
                        <td className="px-3 py-3 align-middle">
                          {r.severity ? (
                            <Badge variant={SEVERITY_VARIANT[r.severity] ?? "secondary"}>
                              {r.severity}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-3 align-middle">
                          {r.documentFilename ? (
                            <a
                              href={`/uploads/${r.documentFilename}`}
                              className="underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              View
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-6 py-3 align-middle text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button asChild variant="outline" size="sm" tooltip="Edit this WHS record">
                              <Link href={`/app/admin/whs/${r.id}/edit`}>Edit</Link>
                            </Button>
                            <DeleteRowForm
                              action={deleteWhsRecordAction}
                              id={r.id}
                              tooltip="Delete this WHS record"
                              confirmMessage={`Delete '${r.title}'?`}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KindLink({
  current,
  kind,
  label,
}: {
  current: string | undefined;
  kind: string | null;
  label: string;
}) {
  const active = (kind === null && !current) || current === kind;
  const href = kind ? `/app/admin/whs?kind=${kind}` : "/app/admin/whs";
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-1.5 ${
        active
          ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)]"
          : "border-[color:var(--border)] hover:bg-[color:var(--secondary)]"
      }`}
    >
      {label}
    </Link>
  );
}
