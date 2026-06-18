"use client";

import { useEffect } from "react";

// Remembers the 1 WK / 2 WK choice in a cookie so a server-action redirect
// that drops the ?range param (create shift, copy day/week, etc.) still brings
// you back to the range you were on. The page reads this cookie as a fallback.
export function PersistRange({ range }: { range: "1w" | "2w" }) {
  useEffect(() => {
    document.cookie = `sc_schedule_range=${range};path=/;max-age=31536000;samesite=lax`;
  }, [range]);
  return null;
}
