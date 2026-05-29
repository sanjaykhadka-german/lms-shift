import "server-only";
import crypto from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { forTenant, lmsUploadedFiles } from "@tracey/db";

// Accepts a multipart-form `File`, normalizes via sharp (auto-rotate, resize
// max 800x800, re-encode to JPEG so EXIF stripping is automatic), and stores
// the result in `uploaded_files` (BYTEA-backed; survives Render's ephemeral
// disk). Returns the stored filename — write that into `users.photo_filename`.
//
// Mirrors set_user_photo (app.py:644-654): persists the new file, then
// deletes the previous one if the caller passes its filename.

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB raw upload cap
const ACCEPTED_KINDS = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export class PhotoUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

export interface SavePhotoOpts {
  /** Multipart File from a server action. */
  file: File;
  /** Optional uploader id for the audit column on uploaded_files. */
  uploadedByLmsUserId?: number | null;
  /** Existing photo filename to delete if the upload succeeds. */
  previousFilename?: string | null;
  /** Tenant the new uploaded_files row belongs to. Required after Slice 3. */
  traceyTenantId: string;
}

export async function saveUserPhoto(opts: SavePhotoOpts): Promise<string> {
  if (opts.file.size === 0) {
    throw new PhotoUploadError("No file selected.");
  }
  if (opts.file.size > MAX_BYTES) {
    const mb = Math.round(opts.file.size / (1024 * 1024));
    throw new PhotoUploadError(`File too large (${mb} MB). Max 8 MB.`);
  }
  if (!ACCEPTED_KINDS.has(opts.file.type)) {
    throw new PhotoUploadError("Use a JPEG, PNG, WebP, or GIF image.");
  }

  const raw = Buffer.from(await opts.file.arrayBuffer());

  let processed: Buffer;
  try {
    processed = await sharp(raw)
      .rotate()
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new PhotoUploadError("Couldn't process that image.");
  }

  const stored = `photo_${crypto.randomBytes(8).toString("hex")}.jpg`;
  await forTenant(opts.traceyTenantId).run(async (tx) => {
    await tx.insert(lmsUploadedFiles).values({
      filename: stored,
      mimeType: "image/jpeg",
      data: processed,
      size: processed.byteLength,
      uploadedById: opts.uploadedByLmsUserId ?? null,
      traceyTenantId: opts.traceyTenantId,
    });
    if (opts.previousFilename && opts.previousFilename !== stored) {
      // The DELETE filters by globally-unique filename (no tenant column on
      // the predicate), but the GUC is set so RLS still applies — the
      // delete only succeeds if the row is in this tenant.
      await tx
        .delete(lmsUploadedFiles)
        .where(eq(lmsUploadedFiles.filename, opts.previousFilename));
    }
  });

  return stored;
}

/** Mirror clear_user_photo (app.py:657). Deletes the BYTEA row; caller is
 *  responsible for nulling `users.photo_filename`. The filename is a
 *  globally-unique random hex token (see saveBinaryUpload), but RLS still
 *  requires `app.tenant_id` to be set or the delete silently affects zero
 *  rows. Caller passes its tenant id; the policy on uploaded_files double-
 *  checks that the row really does belong to this tenant. */
export async function deleteStoredPhoto(
  filename: string,
  traceyTenantId: string,
): Promise<void> {
  if (!filename) return;
  await forTenant(traceyTenantId).run((tx) =>
    tx.delete(lmsUploadedFiles).where(eq(lmsUploadedFiles.filename, filename)),
  );
}

// ─── General-purpose binary upload (covers, content media, PDFs, etc.) ─────

const ALLOWED_BINARY_EXTS = new Set([
  // images
  "png", "jpg", "jpeg", "gif", "webp",
  // video
  "mp4", "mov", "webm",
  // audio
  "mp3", "wav", "m4a", "ogg",
  // documents
  "pdf", "doc", "docx", "txt", "md",
]);

const BINARY_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches Flask MAX_PERSISTED_FILE_BYTES

export interface SaveBinaryOpts {
  file: File;
  prefix: string; // e.g. "cover_", "media_", "content_"
  uploadedByLmsUserId?: number | null;
  traceyTenantId: string;
}

/** Persist any allowed-extension upload (image/video/audio/pdf/doc) into
 *  uploaded_files. Returns the stored filename. Mirrors save_upload
 *  (app.py:610) but with no disk fallback. */
export async function saveBinaryUpload(opts: SaveBinaryOpts): Promise<string> {
  if (opts.file.size === 0) {
    throw new PhotoUploadError("No file selected.");
  }
  if (opts.file.size > BINARY_MAX_BYTES) {
    const mb = Math.round(opts.file.size / (1024 * 1024));
    throw new PhotoUploadError(`File too large (${mb} MB). Max 10 MB.`);
  }

  const original = opts.file.name || "";
  const dot = original.lastIndexOf(".");
  if (dot < 0) throw new PhotoUploadError("File has no extension.");
  const ext = original.slice(dot + 1).toLowerCase();
  if (!ALLOWED_BINARY_EXTS.has(ext)) {
    throw new PhotoUploadError(`File type .${ext} is not allowed.`);
  }

  const buf = Buffer.from(await opts.file.arrayBuffer());
  const stored = `${opts.prefix}${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const mime = opts.file.type || "application/octet-stream";

  await forTenant(opts.traceyTenantId).run((tx) =>
    tx.insert(lmsUploadedFiles).values({
      filename: stored,
      mimeType: mime,
      data: buf,
      size: buf.byteLength,
      uploadedById: opts.uploadedByLmsUserId ?? null,
      traceyTenantId: opts.traceyTenantId,
    }),
  );
  return stored;
}
