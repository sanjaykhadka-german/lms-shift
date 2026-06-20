"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// R3 — keep the "who's clocked in now" board live without a manual reload.
// 30s is frequent enough for an attendance view without hammering the server
// (the page is force-dynamic, so each refresh re-queries).
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
