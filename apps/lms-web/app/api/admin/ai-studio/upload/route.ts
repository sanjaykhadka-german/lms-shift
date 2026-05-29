import { NextResponse } from "next/server";
import { requireAdminAction } from "~/lib/auth/admin";
import { BillingGateError } from "~/lib/billing/guard";
import {
  FileTooLargeError,
  ThinContentError,
  UnsupportedFileError,
  processUpload,
} from "~/lib/ai/files";
import { getStudioSession, saveStudioSession } from "~/lib/ai/sessions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let ctx;
  try {
    ctx = await requireAdminAction();
  } catch (err) {
    if (err instanceof BillingGateError) {
      return NextResponse.json(
        { error: "subscription_required", level: err.level, status: err.tenantStatus },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = ctx.traceyUserId;
  const tenantId = ctx.traceyTenantId;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  let processed;
  try {
    processed = await processUpload(file);
  } catch (err) {
    if (err instanceof FileTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    if (err instanceof UnsupportedFileError) {
      return NextResponse.json({ error: err.message }, { status: 415 });
    }
    if (err instanceof ThinContentError) {
      return NextResponse.json(
        {
          error: "thin",
          message: err.message,
          wordCount: err.wordCount,
          filename: err.filename,
        },
        { status: 400 },
      );
    }
    console.error("[ai-studio] upload failed:", err);
    const msg =
      err instanceof Error ? err.message : "Could not process the uploaded file.";
    return NextResponse.json(
      { error: `Could not process ${file.name}: ${msg}` },
      { status: 422 },
    );
  }

  const state = await getStudioSession(userId, tenantId);
  await saveStudioSession(userId, tenantId, {
    files: [...state.files, processed.stored],
  });

  return NextResponse.json({
    file: {
      id: processed.stored.id,
      kind: processed.stored.kind,
      name: processed.stored.name,
      size: processed.stored.size,
    },
  });
}
