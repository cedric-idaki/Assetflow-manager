/**
 * Regenerates the PWA / Play Store icon set and the favicons from
 * public/icons/icon.svg — that file is the single source of the Ararat mark.
 *
 *   node scripts/generate-icons.mjs
 *
 * Requires `sharp`, a devDependency — it is only ever run by hand, so it stays
 * out of the app bundle and off the build path.
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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
const storeDir = join(root, 'store-assets');
const source = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');

const NAVY = '#0c2037';
const MASKABLE_SCALE = 0.86; // keeps the mark inside Android's 80% safe circle

/** Full-bleed variant: square background, mark shrunk into the safe zone. */
const maskableSvg = source
  .replace('<rect width="512" height="512" rx="112"', '<rect width="512" height="512"')
  .replace(
    '<g id="mark">',
    `<g id="mark" transform="translate(256 256) scale(${MASKABLE_SCALE}) translate(-256 -256)">`,
  );

if (maskableSvg === source) {
  throw new Error('icon.svg no longer matches the strings this script rewrites — see its comment.');
}

const render = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 });

const targets = [
  [iconsDir, 'icon-192.png', () => render(source, 192)],
  [iconsDir, 'icon-512.png', () => render(source, 512)],
  [iconsDir, 'icon-maskable-192.png', () => render(maskableSvg, 192)],
  [iconsDir, 'icon-maskable-512.png', () => render(maskableSvg, 512)],
  [iconsDir, 'apple-touch-icon.png', () => render(maskableSvg, 180)],
  // Listing artwork, not a site file, so it goes to store-assets/ alongside the
  // feature graphic — that is where PLAY_STORE.md tells the submitter to look.
  // Play Console rejects alpha on the store listing icon, so flatten it.
  [storeDir, 'playstore-icon-512.png', () => render(maskableSvg, 512).flatten({ background: NAVY })],
];

mkdirSync(iconsDir, { recursive: true });
mkdirSync(storeDir, { recursive: true });

for (const [dir, name, build] of targets) {
  await build().toFile(join(dir, name));
  console.log(`wrote ${relative(root, join(dir, name)).split(sep).join('/')}`);
}

/**
 * favicon.ico — still worth shipping: it is what a browser falls back to when
 * it ignores the SVG icon, and what Windows pins and some crawlers read.
 *
 * An .ico is just a 6-byte directory header, one 16-byte entry per image, then
 * the images concatenated. Modern .ico allows a PNG payload verbatim, so the
 * sharp output goes in untouched — no BMP/DIB re-encoding needed. A dimension
 * of 256 is stored as 0, which is why the byte is masked.
 */
const FAVICON_SIZES = [16, 32, 48, 64, 128, 256];

const pngs = await Promise.all(
  FAVICON_SIZES.map((size) => render(source, size).toBuffer()),
);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);                  // reserved
header.writeUInt16LE(1, 2);                  // 1 = icon (2 would be a cursor)
header.writeUInt16LE(pngs.length, 4);

const directory = Buffer.alloc(16 * pngs.length);
let offset = header.length + directory.length;

pngs.forEach((png, i) => {
  const at = i * 16;
  const size = FAVICON_SIZES[i];
  directory.writeUInt8(size & 0xff, at);      // 256 wraps to 0, as the spec wants
  directory.writeUInt8(size & 0xff, at + 1);
  directory.writeUInt8(0, at + 2);            // palette size — 0 for truecolour
  directory.writeUInt8(0, at + 3);            // reserved
  directory.writeUInt16LE(1, at + 4);         // colour planes
  directory.writeUInt16LE(32, at + 6);        // bits per pixel
  directory.writeUInt32LE(png.length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += png.length;
});

const ico = Buffer.concat([header, directory, ...pngs]);

// public/favicon.ico is the one that gets served; the repo-root copy is what
// tooling that looks beside package.json picks up. Keep them identical.
for (const target of [join(root, 'public', 'favicon.ico'), join(root, 'favicon.ico')]) {
  writeFileSync(target, ico);
  console.log(`wrote ${relative(root, target).split(sep).join('/')}`);
}
