import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  forTenant,
  scDocuments,
  users,
} from "@tracey/db";
import { File, FileImage, FileText } from "lucide-react";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { UploadDocumentForm } from "../_components/UploadDocumentForm";
import { deleteDocumentAction } from "./_actions";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Document library · ShiftCraft" };
export const dynamic = "force-dynamic";

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

export default async function DocumentLibraryPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;
  const canManage = isAtLeastManager(membership.role);

  // Library documents — workspace-wide, ordered newest first.
  const docs = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scDocuments.id,
        title: scDocuments.title,
        notes: scDocuments.notes,
        mimeType: scDocuments.mimeType,
        fileSize: scDocuments.fileSize,
        uploadedAt: scDocuments.uploadedAt,
        uploaderName: users.name,
        uploaderEmail: users.email,
      })
      .from(scDocuments)
      .leftJoin(users, eq(users.id, scDocuments.uploadedByUserId))
      .where(
        and(
          eq(scDocuments.scope, "library"),
          isNull(scDocuments.employeeId),
        ),
      )
      .orderBy(desc(scDocuments.uploadedAt)),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Document library
          <InfoPopover label="About the document library">
            <p>
              Workspace-wide files (handbook, policies, contract
              templates). Anyone on the team can download; only managers
              can upload.
            </p>
            <p className="mt-1">
              Per-employee certs (licences, signed contracts) live on{" "}
              <a href="/app/people/team-documents" className="underline">
                Team documents
              </a>{" "}
              instead.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Workspace-wide documents — handbook, policies, contract templates.
          Anyone on the team can download; only managers can upload.
        </p>
      </div>

      {/* ─── Upload (admin only) ─── */}
      {canManage ? (
        <details className="rounded-lg border border-border bg-card shadow-sm">
          <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium hover:bg-muted/30">
            <span>Upload a document</span>
            <span className="text-xs text-muted-foreground">
              PDF / image / Word · max 5 MB
            </span>
          </summary>
          <div className="border-t border-border px-5 py-4">
            <UploadDocumentForm scope="library" />
          </div>
        </details>
      ) : null}

      {/* ─── Document list ─── */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            All documents ({docs.length})
          </h2>
        </div>
        {docs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            {canManage
              ? "Nothing uploaded yet. Use the form above to add the first document."
              : "Nothing has been uploaded yet. Check back later."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <MimeIcon mime={d.mimeType} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <Link
                      href={`/app/people/documents/${d.id}/download`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {d.title}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">
                      {formatSize(d.fileSize)} · {d.mimeType} ·{" "}
                      Uploaded {fmtDate(d.uploadedAt)}
                      {d.uploaderName
                        ? ` by ${d.uploaderName}`
                        : d.uploaderEmail
                          ? ` by ${d.uploaderEmail}`
                          : ""}
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
