import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { requireAdminAction } from "~/lib/auth/admin";
import { BillingGateError } from "~/lib/billing/guard";
import { getClaudeApiKey, sendMessage } from "~/lib/ai/claude";
import { getStudioSession, saveStudioSession } from "~/lib/ai/sessions";

export const runtime = "nodejs";
export const maxDuration = 300; // Anthropic requests can run long; allow 5 min.

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
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const userId = ctx.traceyUserId;
  const tenantId = ctx.traceyTenantId;

  if (!getClaudeApiKey()) {
    return NextResponse.json(
      {
        error:
          "AI Studio is not configured. Set ANTHROPIC_API_KEY or CLAUDE_API_KEY on the server.",
      },
      { status: 503 },
    );
  }

  const body = (await req.json()) as { text?: string; fileIds?: string[] };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Message text is required" }, { status: 400 });
  }
  const requestedFileIds = new Set(body.fileIds ?? []);

  const state = await getStudioSession(userId, tenantId);

  // Attach files that are referenced for the first time (not yet in history).
  // We track this by stamping each file as "attached" once the response lands.
  const attachments: Anthropic.ContentBlockParam[] = [];
  for (const file of state.files) {
    if (!requestedFileIds.has(file.id)) continue;
    if (file.kind === "pdf") {
      attachments.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: file.body },
      });
    } else if (file.kind === "image") {
      attachments.push({
        type: "image",
        source: {
          type: "base64",
          media_type: file.mime as
            | "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp",
          data: file.body,
        },
      });
    } else if (file.kind === "docx") {
      attachments.push({
        type: "text",
        text:
          `Reference document: ${file.name}\n\n` +
          `--- begin extracted text ---\n${file.body}\n--- end extracted text ---`,
      });
    }
  }

  const result = await sendMessage({
    history: state.history,
    attachments,
    text,
  });

  await saveStudioSession(userId, tenantId, {
    history: result.nextHistory,
    currentModuleJson: result.moduleJson ?? state.currentModuleJson,
  });

  return NextResponse.json({
    reply: result.visibleReply,
    moduleJson: result.moduleJson,
  });
}
