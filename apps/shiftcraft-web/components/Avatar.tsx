import { avatarColourFor, initialsFor } from "~/lib/avatar";

interface Props {
  name: string | null;
  email: string;
  image: string | null;
  /** Tailwind size class. Defaults to h-9 w-9 (36px) — roster row size. */
  sizeClass?: string;
  /** Font-size override for initials when sizeClass is bigger/smaller. */
  textClass?: string;
}

/**
 * Displays a person's avatar.
 *
 * - When `image` is a usable URL we render it as <img>. The validator
 *   in lib/avatar.ts gates writes to http/https only, so this is safe.
 *   Older rows may carry a non-URL string from a previous schema; we
 *   guard at render time to defaults rather than ship a broken icon.
 * - Otherwise we draw a coloured circle with 1-2 character initials.
 *   The colour is deterministic from email so the same person shows
 *   up as the same swatch everywhere they appear.
 */
export function Avatar({
  name,
  email,
  image,
  sizeClass = "h-9 w-9",
  textClass = "text-xs",
}: Props) {
  const looksLikeUrl =
    typeof image === "string" &&
    (image.startsWith("http://") || image.startsWith("https://"));
  if (looksLikeUrl) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={image}
        alt=""
        className={`${sizeClass} flex-shrink-0 rounded-[10px] object-cover`}
      />
    );
  }
  const colour = avatarColourFor(email);
  const initials = initialsFor(name, email);
  return (
    <div
      aria-hidden
      className={`${sizeClass} ${textClass} flex flex-shrink-0 items-center justify-center rounded-[10px] font-display font-semibold text-white`}
      style={{ backgroundColor: colour }}
    >
      {initials}
    </div>
  );
}
