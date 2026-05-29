import { NextResponse } from "next/server";
import { forTenant } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { BillingGateError } from "~/lib/billing/guard";
import { logAuditEvent } from "~/lib/audit";
import { ApplyModuleError, importModuleFromJson } from "~/lib/ai/apply-module";
import { getStudioSession, saveStudioSession } from "~/lib/ai/sessions";
import { snapshotModuleVersion } from "~/lib/lms/module-versions";

export const runtime = "nodejs";

export async function POST() {
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
  const tid = ctx.traceyTenantId;
  const state = await getStudioSession(ctx.traceyUserId, tid);
  const raw = (state.currentModuleJson ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      { error: "No AI module to import. Ask the AI to generate one first." },
      { status: 400 },
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { error: `AI output could not be parsed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  let createdIds: number[];
  try {
    createdIds = await importModuleFromJson({
      data,
      tenantId: tid,
      createdById: ctx.lmsUser.id,
    });
  } catch (err) {
    if (err instanceof ApplyModuleError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  for (const id of createdIds) {
    await logAuditEvent({
      tenantId: tid,
      actorUserId: ctx.traceyUserId,
      actorEmail: ctx.lmsUser.email,
      action: "module.ai_imported",
      targetKind: "module",
      targetId: String(id),
      details: { count: createdIds.length },
    });
    // Best-effort version snapshot — gives every AI-imported module a v1
    // record for diff/rollback. Failure here logs but doesn't block the
    // import response since the module itself is already persisted.
    try {
      await snapshotModuleVersion({
        tdb: forTenant(tid),
        moduleId: id,
        tenantId: tid,
        createdById: ctx.lmsUser.id,
        summary: "Imported from AI Studio",
      });
    } catch (err) {
      console.error("[ai-studio.import] version snapshot failed for", id, err);
    }
  }

  // Reset the draft AND remember which module came out of this session so
  // a subsequent rehydrate (browser back, sidebar nav, /ai-studio reload
  // without ?module_id) still knows where the Preview / Advanced edit
  // buttons should navigate to.
  await saveStudioSession(ctx.traceyUserId, tid, {
    currentModuleJson: null,
    moduleId: createdIds[0] ?? null,
  });
  return NextResponse.json({ ok: true, moduleIds: createdIds });
}
