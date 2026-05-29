// Generate PWA icons from an inline SVG using `sharp` (already a dev dep).
//
// Outputs (relative to apps/lms-web):
//   public/icons/icon-192.png            — 192x192, 12% padding
//   public/icons/icon-512.png            — 512x512, 12% padding
//   public/icons/icon-512-maskable.png   — 512x512, 25% safe-zone padding
//   public/icons/apple-touch-icon.png    — 180x180, 12% padding
//
// Re-run with `pnpm --filter lms-web icons:pwa` if the brand monogram changes.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "public", "icons");

const BG = "#0a0a0a";
const FG = "#ffffff";

/**
 * Build the icon SVG. `inset` is the padding ratio (0..0.5) — bigger inset
 * means more empty space around the glyph (used for the maskable variant
 * so the safe zone covers Android's circular/squircle crop).
 */
function svg(size, inset) {
  const fontSize = Math.round(size * (1 - inset * 2) * 0.78);
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <text x="50%" y="50%"
        text-anchor="middle"
        dominant-baseline="central"
        font-family="-apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-weight="800"
        font-size="${fontSize}"
        fill="${FG}">T</text>
</svg>`.trim();
}

async function render(size, inset, filename) {
  const buf = Buffer.from(svg(size, inset));
  const out = path.join(outDir, filename);
  await sharp(buf).png().toFile(out);
  console.log(`wrote ${path.relative(path.resolve(here, ".."), out)}`);
}

await mkdir(outDir, { recursive: true });
await render(192, 0.12, "icon-192.png");
await render(512, 0.12, "icon-512.png");
await render(512, 0.25, "icon-512-maskable.png");
await render(180, 0.12, "apple-touch-icon.png");
