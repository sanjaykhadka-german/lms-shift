// GET /api/visitor-signature/<visitorSigninId>?which=in|out
//
// Streams the bytea signature (PNG) stored against a visitor sign-in row.
// Manager+ only, tenant-scoped via forTenant so a cross-tenant id can't be
// probed. `which` selects the sign-in (default) or sign-out signature.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { forTenant, scVisitorSignins } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const which =
    new URL(request.url).searchParams.get("which") === "out" ? "out" : "in";

  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) {
    return new NextResponse(null, { status: 403 });
  }
  const tenantId = membership.tenant.id;

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        signIn: scVisitorSignins.signInSignature,
        signOut: scVisitorSignins.signOutSignature,
      })
      .from(scVisitorSignins)
      .where(
        and(
          eq(scVisitorSignins.id, id),
          eq(scVisitorSignins.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );

  const image = which === "out" ? row?.signOut : row?.signIn;
  if (!image) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
