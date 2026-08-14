/**
 * Regenerates the PWA / Play Store icon set from public/icons/icon.svg.
 *
 *   node scripts/generate-icons.mjs
 *
 * Requires `sharp`, which is currently present transitively via the toolchain.
 * If it ever disappears: npm i -D sharp
 *
 * Two families come out of this, and the difference matters:
 *
 *   - "any" icons keep the rounded corners baked into icon.svg. They are what
 *     a browser tab or an install prompt shows, unmodified.
 *
 *   - "maskable" icons are full-bleed squares. Android crops them to whatever
 *     shape the launcher uses (circle, squircle, teardrop), so the artwork has
 *     to survive a circular crop of 80% of the width — the safe zone. The mark
 *     is scaled to MASKABLE_SCALE and the rounded corners are dropped, because
 *     rounded corners under a circular mask read as a shrunken sticker.
 *
 * The Play Console store listing icon is a third case: it must be an opaque
 * 512x512 with no transparency, and Google applies its own rounding.
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
const source = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');

const NAVY = '#0c2037';
const MASKABLE_SCALE = 0.78; // keeps the mark inside Android's 80% safe circle

/** Full-bleed variant: square background, mark shrunk into the safe zone. */
const maskableSvg = source
  .replace('<rect width="512" height="512" rx="112"', '<rect width="512" height="512"')
  .replace(
    '<g fill="none" stroke="url(#mark)"',
    `<g transform="translate(256 256) scale(${MASKABLE_SCALE}) translate(-256 -256)" fill="none" stroke="url(#mark)"`,
  );

const render = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 });

const targets = [
  ['icon-192.png', () => render(source, 192)],
  ['icon-512.png', () => render(source, 512)],
  ['icon-maskable-192.png', () => render(maskableSvg, 192)],
  ['icon-maskable-512.png', () => render(maskableSvg, 512)],
  ['apple-touch-icon.png', () => render(maskableSvg, 180)],
  // Play Console rejects alpha on the store listing icon, so flatten it.
  ['playstore-icon-512.png', () => render(maskableSvg, 512).flatten({ background: NAVY })],
];

mkdirSync(iconsDir, { recursive: true });

for (const [name, build] of targets) {
  await build().toFile(join(iconsDir, name));
  console.log(`wrote public/icons/${name}`);
}
