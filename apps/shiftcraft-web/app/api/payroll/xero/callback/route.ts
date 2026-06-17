import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { currentMembership, currentUser } from "~/lib/auth/current";
import {
  exchangeAuthCode,
  isXeroConfigured,
  saveConnection,
} from "~/lib/payroll/xero";
import { logAuditEvent } from "~/lib/audit";

// OAuth redirect handler for Xero (AUDIT.md #5).
//
// 1. Match the `state` cookie set by the Connect button against the
//    one Xero echoes back. Bail on mismatch — could be CSRF or stale.
// 2. Exchange the auth code for an access + refresh token set.
// 3. Persist the encrypted tokens against the tenant.
// 4. Redirect to /app/admin/payroll with the connection visible.

const STATE_COOKIE = "sc_xero_oauth_state";

// Behind Render's proxy, req.url is the INTERNAL origin (http://localhost:10000),
// so redirects built from it send the browser to a dead address. Reconstruct
// the public origin from the forwarded headers the proxy sets.
function publicOrigin(req: NextRequest): string {
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isXeroConfigured()) {
    return NextResponse.json(
      { error: "Xero is not configured on this server." },
      { status: 503 },
    );
  }

  const base = publicOrigin(req);
  const url = new URL(req.url);
  const errParam = url.searchParams.get("error");
  if (errParam) {
    const desc =
      url.searchParams.get("error_description") ?? errParam;
    return NextResponse.redirect(
      new URL(
        `/app/admin/payroll?xero_error=${encodeURIComponent(desc)}`,
        base,
      ),
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(
      new URL(
        "/app/admin/payroll?xero_error=missing_code_or_state",
        base,
      ),
    );
  }

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  if (!expected || expected !== state) {
    return NextResponse.redirect(
      new URL("/app/admin/payroll?xero_error=state_mismatch", base),
    );
  }
  // Single-use state — invalidate immediately whether or not the
  // exchange succeeds.
  jar.delete(STATE_COOKIE);

  const membership = await currentMembership();
  if (!membership) {
    return NextResponse.redirect(new URL("/sign-in", base));
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", base));
  }

  try {
    const exchange = await exchangeAuthCode(req.url, state);
    await saveConnection(membership.tenant.id, user.id, exchange);
    await logAuditEvent({
      action: "shiftcraft.xero.connected",
      targetKind: "sc_xero_connection",
      details: {
        xeroTenantId: exchange.xeroTenantId,
        xeroTenantName: exchange.xeroTenantName,
      },
    });
    return NextResponse.redirect(
      new URL("/app/admin/payroll?connected=1", base),
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Token exchange failed.";
    return NextResponse.redirect(
      new URL(
        `/app/admin/payroll?xero_error=${encodeURIComponent(message)}`,
        base,
      ),
    );
  }
}
