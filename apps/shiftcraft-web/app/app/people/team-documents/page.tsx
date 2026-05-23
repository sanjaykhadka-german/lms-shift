import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { File, FileImage, FileText } from "lucide-react";
import {
  forTenant,
  scDocuments,
  scEmployees,
  users,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";
import { UploadDocumentForm } from "../_components/UploadDocumentForm";
import { deleteDocumentAction } from "../documents/_actions";

export const metadata = { title: "Team documents · ShiftCraft" };
export const dynamic = "force-dynamic";

const EXPIRY_WARN_DAYS = 30;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function MimeIcon({ mime, className }: { mime: string; className?: string }) {
  if (mime.startsWith("image/"))
    return <FileImage className={className} aria-hidden />;
  if (mime === "application/pdf" || mime === "text/plain")
    return <FileText className={className} aria-hidden />;
  return <File className={className} aria-hidden />;
}

function daysUntil(d: Date | null): number | null {
  if (!d) return null;
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function ExpiryBadge({ expiresAt }: { expiresAt: Date | null }) {
  if (!expiresAt) return null;
  const days = daysUntil(expiresAt);
  if (days === null) return null;
  if (days < 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
        Expired {fmtDate(expiresAt)}
      </span>
    );
  }
  if (days <= EXPIRY_WARN_DAYS) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
        Expires in {days} {days === 1 ? "day" : "days"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      Expires {fmtDate(expiresAt)}
    </span>
  );
}

type SearchParams = { expiring?: string };

export default async function TeamDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;
  const canManage = isAtLeastManager(membership.role);

  const { expiring } = await searchParams;
  const expiringOnly = expiring === "1";

  const [docs, activeEmployees] = await forTenant(tenantId).run(async (tx) => {
    const rows = await tx
      .select({
        id: scDocuments.id,
        title: scDocuments.title,
        notes: scDocuments.notes,
        mimeType: scDocuments.mimeType,
        fileSize: scDocuments.fileSize,
        uploadedAt: scDocuments.uploadedAt,
        expiresAt: scDocuments.expiresAt,
        employeeId: scDocuments.employeeId,
        employeeName: scEmployees.fullName,
        employeeEmail: scEmployees.email,
        uploaderName: users.name,
      })
      .from(scDocuments)
      .leftJoin(scEmployees, eq(scEmployees.id, scDocuments.employeeId))
      .leftJoin(users, eq(users.id, scDocuments.uploadedByUserId))
      .where(
        and(
          eq(scDocuments.scope, "team"),
          isNotNull(scDocuments.employeeId),
        ),
      )
      .orderBy(asc(scDocuments.expiresAt), desc(scDocuments.uploadedAt));

    const employeeRows = canManage
      ? await tx
          .select({
            id: scEmployees.id,
            fullName: scEmployees.fullName,
            email: scEmployees.email,
          })
          .from(scEmployees)
          .where(eq(scEmployees.isActive, true))
          .orderBy(asc(scEmployees.fullName))
      : [];

    return [rows, employeeRows];
  });

  const filtered = expiringOnly
    ? docs.filter((d) => {
        const days = daysUntil(d.expiresAt);
        return days !== null && days <= EXPIRY_WARN_DAYS;
      })
    : docs;

  const expiringCount = docs.filter((d) => {
    const days = daysUntil(d.expiresAt);
    return days !== null && days <= EXPIRY_WARN_DAYS;
  }).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Team documents
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-employee documents — signed contracts, licences,
          certifications. Set an expiry to get an alert when something is
          about to lapse.
        </p>
      </div>

      {/* ─── Filter toggle ─── */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href="/app/people/team-documents"
          className={`rounded-md border px-3 py-1.5 ${!expiringOnly ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
        >
          All ({docs.length})
        </Link>
        <Link
          href="/app/people/team-documents?expiring=1"
          className={`rounded-md border px-3 py-1.5 ${expiringOnly ? "border-amber-500 bg-amber-500 text-white" : "border-border bg-background hover:bg-muted"}`}
        >
          Expiring in {EXPIRY_WARN_DAYS} days ({expiringCount})
        </Link>
      </div>

      {/* ─── Upload (admin only) ─── */}
      {canManage ? (
        <details className="rounded-lg border border-border bg-card shadow-sm">
          <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium hover:bg-muted/30">
            <span>Upload a document for someone</span>
            <span className="text-xs text-muted-foreground">
              Optional expiry · max 5 MB
            </span>
          </summary>
          <div className="border-t border-border px-5 py-4">
            <UploadDocumentForm
              scope="team"
              employees={activeEmployees.map((e) => ({
                id: e.id,
                label: `${e.fullName}${e.email ? ` · ${e.email}` : ""}`,
              }))}
            />
          </div>
        </details>
      ) : null}

      {/* ─── Document list ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            {expiringOnly ? "Expiring soon" : "All team documents"} ({filtered.length})
          </h2>
        </div>
        {filtered.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            {expiringOnly
              ? "Nothing is expiring in the next 30 days."
              : canManage
                ? "No team documents yet. Use the form above to upload one for an employee."
                : "No team documents yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={d.employeeName ?? "?"}
                    email={d.employeeEmail ?? d.employeeName ?? "?"}
                    image={null}
                    sizeClass="h-9 w-9"
                    textClass="text-xs"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/app/people/documents/${d.id}/download`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {d.title}
                      </Link>
                      <ExpiryBadge expiresAt={d.expiresAt} />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {d.employeeName ?? "—"}
                      {" · "}
                      <MimeIcon mime={d.mimeType} className="inline h-3 w-3 align-text-bottom" />{" "}
                      {formatSize(d.fileSize)}
                      {" · Uploaded "}
                      {fmtDate(d.uploadedAt)}
                      {d.uploaderName ? ` by ${d.uploaderName}` : ""}
                    </div>
                    {d.notes ? (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {d.notes}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`/app/people/documents/${d.id}/download`}
                      download
                    >
                      Download
                    </a>
                  </Button>
                  {canManage ? (
                    <form action={deleteDocumentAction}>
                      <input type="hidden" name="documentId" value={d.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className="text-[color:var(--destructive)] hover:bg-[color:var(--destructive)]/10"
                      >
                        Delete
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
