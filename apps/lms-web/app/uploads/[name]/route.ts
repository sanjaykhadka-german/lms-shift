import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, lmsUploadedFiles } from "@tracey/db";
import { requireTenant } from "~/lib/auth/current";
import {
  getUploadForAdmin,
  getUploadForLearner,
  requireLearner,
} from "~/lib/lms/learner";

async function getOwnPhotoUpload(filename: string) {
  const rows = await db
    .select()
    .from(lmsUploadedFiles)
    .where(eq(lmsUploadedFiles.filename, filename))
    .limit(1);
  return rows[0] ?? null;
}

// Tenant-scoped port of Flask's /uploads/<name> (app.py:3886). Streams the
// BYTEA stored in `uploaded_files`. Disk-fallback is intentionally dropped:
// Render's free-tier ephemeral disk wipes anything not in the DB.
//
// Admins can fetch any file in the tenant (incl. user photos which aren't
// referenced by any module). Learners are still restricted to files
// referenced by a module they're currently assigned to.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!name) return new NextResponse("Not Found", { status: 404 });

  const { tenant, role } = await requireTenant();
  const isAdmin = role === "owner" || role === "admin";

  let file: Awaited<ReturnType<typeof getUploadForLearner>> = null;
  if (isAdmin) {
    file = await getUploadForAdmin(name, tenant.id);
  }
  if (!file) {
    const { lmsUser, traceyTenantId } = await requireLearner();
    // A user may always read their own profile photo, even though it isn't
    // referenced by any module (so getUploadForLearner alone wouldn't allow it).
    if (lmsUser.photoFilename === name) {
      file = await getOwnPhotoUpload(name);
    }
    if (!file) {
      file = await getUploadForLearner(name, lmsUser.id, traceyTenantId);
    }
  }
  if (!file) return new NextResponse("Not Found", { status: 404 });

  // Copy into a fresh ArrayBuffer so TS's BlobPart type (which forbids
  // SharedArrayBuffer-backed views) accepts it. Negligible cost vs the
  // disk/network it just came from.
  const ab = new ArrayBuffer(file.data.byteLength);
  new Uint8Array(ab).set(file.data);
  const blob = new Blob([ab], { type: file.mimeType });
  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(blob.size),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
