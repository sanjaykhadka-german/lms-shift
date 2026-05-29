import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { cookies } from "next/headers";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { bulkUploadEmployeesAction } from "./actions";

export const metadata = { title: "Bulk-upload employees" };

interface BulkErrors {
  errors: Array<{ row: number; email: string; reason: string }>;
}

export default async function BulkUploadPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    created?: string;
    skipped?: string;
    invited?: string;
  }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  const errCookie = cookieStore.get("tracey.bulkErrors")?.value;
  let errors: BulkErrors["errors"] = [];
  if (errCookie) {
    try {
      const parsed = JSON.parse(errCookie) as BulkErrors;
      errors = parsed.errors ?? [];
    } catch {
      // ignore malformed cookie
    }
  }

  const created = parseInt(sp.created ?? "0", 10);
  const skipped = parseInt(sp.skipped ?? "0", 10);
  const invited = parseInt(sp.invited ?? "0", 10);

  return (
    <div className="space-y-6">
      <BackLink href="/app/admin/employees">Back to employees</BackLink>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk-upload employees</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Upload a CSV to add multiple staff members at once. Each row creates
          one user and emails them a temporary password.
        </p>
      </div>

      {sp.ok === "1" && <ResultBanner created={created} skipped={skipped} invited={invited} />}
      {sp.error === "nofile" && <ErrorBanner message="No file selected." />}
      {sp.error === "encoding" && <ErrorBanner message="CSV must be UTF-8 encoded." />}
      {sp.error === "empty" && <ErrorBanner message="CSV is empty — no header row found." />}
      {sp.error === "noemail" && <ErrorBanner message="CSV must have an 'Email' column." />}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload</CardTitle>
          <CardDescription>
            <Link href="/app/admin/employees/template.csv" className="underline">
              Download the CSV template
            </Link>{" "}
            (Excel-compatible). Required columns: First Name, Last Name, Email,
            Phone, Department, Employer. Optional: Role, Machines (comma- or
            pipe-separated), Start Date, Termination Date, Job Title, Position.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={bulkUploadEmployeesAction} className="space-y-3">
            <input type="file" name="csv" accept=".csv,text/csv" required />
            <div className="flex gap-2">
              <Button type="submit">Upload</Button>
              <Button asChild variant="outline">
                <Link href="/app/admin/employees">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {sp.ok === "1" && errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Skipped rows ({errors.length})</CardTitle>
            <CardDescription>
              Fix these in your CSV and re-upload — already-imported rows will be
              skipped automatically (duplicate email guard).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  <tr>
                    <th className="px-6 py-2">Row</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {errors.map((e, i) => (
                    <tr key={`${e.row}-${i}`}>
                      <td className="px-6 py-2 align-middle">{e.row}</td>
                      <td className="px-3 py-2 align-middle">{e.email}</td>
                      <td className="px-3 py-2 align-middle">{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultBanner({
  created,
  skipped,
  invited,
}: {
  created: number;
  skipped: number;
  invited: number;
}) {
  let cls = "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10";
  let msg = `Added ${created} staff member${created === 1 ? "" : "s"}. ${invited} invite email${
    invited === 1 ? "" : "s"
  } sent.`;
  if (created > 0 && skipped > 0) {
    cls = "border-amber-500 bg-amber-50/50 dark:bg-amber-900/10";
    msg = `Added ${created}, skipped ${skipped}. See the table below.`;
  } else if (skipped > 0 && created === 0) {
    cls = "border-[color:var(--destructive)] bg-[color:var(--destructive)]/5";
    msg = `Nothing imported — ${skipped} row${skipped === 1 ? "" : "s"} had problems.`;
  } else if (created === 0 && skipped === 0) {
    cls = "border-[color:var(--border)] bg-[color:var(--secondary)]";
    msg = "No data rows to import.";
  }
  return <div className={`rounded-md border px-4 py-2 text-sm ${cls}`}>{msg}</div>;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-4 py-2 text-sm text-[color:var(--destructive)]">
      {message}
    </div>
  );
}
