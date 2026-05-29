import { NextResponse } from "next/server";
import { requireAdminAction } from "~/lib/auth/admin";
import { BillingGateError } from "~/lib/billing/guard";
import { resetStudioSession } from "~/lib/ai/sessions";

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
  await resetStudioSession(ctx.traceyUserId, ctx.traceyTenantId);
  return NextResponse.json({ ok: true });
}
