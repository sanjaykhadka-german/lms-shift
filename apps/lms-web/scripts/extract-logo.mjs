// One-shot script: crops the wordmark out of the brand-spec PNG and writes a
// clean public/tracey-logo.png. Re-runnable. Source path is passed as argv[2].
//
//   node scripts/extract-logo.mjs "C:\Users\Sanjay.Khadka\Downloads\01 _ Geometric.png"
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "../public");
mkdirSync(publicDir, { recursive: true });

const source = process.argv[2];
if (!source) {
  console.error("Usage: node scripts/extract-logo.mjs <path-to-source-png>");
  process.exit(2);
}

const out = resolve(publicDir, "tracey-wordmark.png");

// Source spec sheet is 2700x1680. The wordmark + audio-bars sub-mark sits
// roughly centred around y=830, between x=750 and x=1950. Extract a bounding
// box generous enough to include any kerning/slight off-centring, then let
// sharp.trim() shave white margins down to a tight crop.
const img = sharp(source);
const meta = await img.metadata();
console.log(`source: ${meta.width}x${meta.height}`);

// Coordinates measured directly from the 2700x1680 spec sheet to capture
// the "tracey" wordmark plus its audio-bars sub-mark with minimal padding.
// (sharp.trim() proved unreliable on this asset — threshold tuning didn't
// shave the dead space, so we go with measured bounds instead.)
const left = Math.round(meta.width * 0.26); // ~702 — just before the "t"
const top = Math.round(meta.height * 0.36); // ~605 — top of "t"
const width = Math.round(meta.width * 0.49); // ~1323 — through the "y" tail
const height = Math.round(meta.height * 0.36); // ~605 — bottom of audio bars

await sharp(source)
  .extract({ left, top, width, height })
  .png({ compressionLevel: 9 })
  .toFile(out);

const outMeta = await sharp(out).metadata();
console.log(`wrote ${out} (${outMeta.width}x${outMeta.height})`);
