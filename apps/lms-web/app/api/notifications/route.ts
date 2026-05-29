import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { forTenant, notifications } from "@tracey/db";
import { currentUser, currentMembership } from "~/lib/auth/current";

const FEED_LIMIT = 20;

// GET /api/notifications
// Returns the latest notifications for the current user in the active tenant
// plus the unread count.
export async function GET() {
  const user = await currentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const membership = await currentMembership();
  if (!membership) return NextResponse.json({ unreadCount: 0, items: [] });

  const tid = membership.tenant.id;
  const tdb = forTenant(tid);

  const [items, unreadRow] = await Promise.all([
    tdb.run((tx) =>
      tx
        .select({
          id: notifications.id,
          kind: notifications.kind,
          title: notifications.title,
          body: notifications.body,
          actionUrl: notifications.actionUrl,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, user.id),
            eq(notifications.tenantId, tid),
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(FEED_LIMIT),
    ),
    tdb.run((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, user.id),
            eq(notifications.tenantId, tid),
            isNull(notifications.readAt),
          ),
        ),
    ),
  ]);

  return NextResponse.json({
    unreadCount: unreadRow[0]?.count ?? 0,
    items,
  });
}

// POST /api/notifications
// Body: { ids?: string[], all?: boolean }
// Marks the listed notifications (or all of the user's unread) as read.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const membership = await currentMembership();
  if (!membership) return new NextResponse("No tenant", { status: 400 });
  const tid = membership.tenant.id;
  const tdb = forTenant(tid);

  let payload: { ids?: unknown; all?: unknown } = {};
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  const now = new Date();

  if (payload.all === true) {
    await tdb.run((tx) =>
      tx
        .update(notifications)
        .set({ readAt: now })
        .where(
          and(
            eq(notifications.recipientUserId, user.id),
            eq(notifications.tenantId, tid),
            isNull(notifications.readAt),
          ),
        ),
    );
    return NextResponse.json({ ok: true });
  }

  if (Array.isArray(payload.ids)) {
    const ids = payload.ids.filter((v): v is string => typeof v === "string");
    if (ids.length === 0) return NextResponse.json({ ok: true });
    await tdb.run((tx) =>
      tx
        .update(notifications)
        .set({ readAt: now })
        .where(
          and(
            eq(notifications.recipientUserId, user.id),
            eq(notifications.tenantId, tid),
            inArray(notifications.id, ids),
          ),
        ),
    );
    return NextResponse.json({ ok: true });
  }

  return new NextResponse("ids[] or all required", { status: 400 });
}
