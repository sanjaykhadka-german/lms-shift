// Shared kiosk avatar/identity helpers. Used by the landing dashboard
// (_dashboard.tsx) and the name-select sign-in (_signin.tsx) so both render
// the same initials, the same stable per-person ring colour, and the same
// "since" time format.

// Stable per-person ring colour, hashed from the user id so the same person
// always gets the same colour. Palette mirrors the dashboard mock.
export const RING_PALETTE = [
  "#c0492f",
  "#9a8a5c",
  "#d98324",
  "#3f7d6e",
  "#8a5a8c",
  "#5a6e8c",
];

export function ringColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return RING_PALETTE[h % RING_PALETTE.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function fmtSince(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
