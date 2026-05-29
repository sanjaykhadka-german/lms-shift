import { NextResponse } from "next/server";
import { forTenant } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { BillingGateError } from "~/lib/billing/guard";
import { logAuditEvent } from "~/lib/audit";
import {
  ApplyModuleError,
  applyModuleJsonToExisting,
} from "~/lib/ai/apply-module";
import { getStudioSession, saveStudioSession } from "~/lib/ai/sessions";
import { snapshotModuleVersion } from "~/lib/lms/module-versions";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const { id } = await params;
  const moduleId = parseInt(id, 10);
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "Bad module id" }, { status: 400 });
  }
  const tid = ctx.traceyTenantId;
  const state = await getStudioSession(ctx.traceyUserId, tid);
  const raw = (state.currentModuleJson ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      {
        error:
          "No AI module update available. Ask the AI to refine the module first.",
      },
      { status: 400 },
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
    if (Array.isArray(data)) data = data[0];
  } catch (err) {
    return NextResponse.json(
      { error: `AI output could not be parsed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  try {
    await applyModuleJsonToExisting({ data, moduleId, tenantId: tid });
  } catch (err) {
    if (err instanceof ApplyModuleError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.ai_updated",
    targetKind: "module",
    targetId: String(moduleId),
    details: {},
  });

  // Best-effort: snapshot post-apply state so every AI-driven update has
  // a rollback record. Doesn't block on failure — apply already succeeded.
  try {
    await snapshotModuleVersion({
      tdb: forTenant(tid),
      moduleId,
      tenantId: tid,
      createdById: ctx.lmsUser.id,
      summary: "Applied AI update from AI Studio",
    });
  } catch (err) {
    console.error("[ai-studio.apply] version snapshot failed for", moduleId, err);
  }

  // Mirror the import route: clear the draft AND remember which module
  // this session is associated with so subsequent rehydrates can navigate
  // even when the URL doesn't carry ?module_id.
  await saveStudioSession(ctx.traceyUserId, tid, {
    currentModuleJson: null,
    moduleId,
  });

  return NextResponse.json({ ok: true });
}
