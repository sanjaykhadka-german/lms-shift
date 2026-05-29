const FALLBACK_TZ = "Australia/Sydney";
const LOCALE = "en-AU";

export function formatDateTime(
  d: Date | string | null | undefined,
  timezone: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(LOCALE, {
    timeZone: timezone || FALLBACK_TZ,
    ...opts,
  });
}

export function formatDate(
  d: Date | string | null | undefined,
  timezone: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(LOCALE, {
    timeZone: timezone || FALLBACK_TZ,
    ...opts,
  });
}
