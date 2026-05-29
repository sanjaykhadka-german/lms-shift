import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@tracey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 1000;

async function pingDb(): Promise<boolean> {
  const ping = db.execute(sql`select 1`);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("db ping timeout")), TIMEOUT_MS),
  );
  try {
    await Promise.race([ping, timeout]);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const dbOk = await pingDb();
  return NextResponse.json(
    { ok: dbOk, db: dbOk ? "up" : "down" },
    { status: dbOk ? 200 : 503 },
  );
}
