/**
 * Generates the Google Play store-listing graphics into store-assets/.
 *
 *   node scripts/generate-store-assets.mjs
 *
 * These are listing artwork, not site files — they deliberately live outside
 * public/ so they never get deployed to the web server.
 *
 * Play asks for two fixed-size images before a listing can be submitted:
 *   - a 512x512 app icon, opaque, no alpha (comes from generate-icons.mjs)
 *   - a 1024x500 feature graphic, shown at the top of the store listing
 *
 * The feature graphic gets cropped at the edges on some surfaces and can have
 * the app icon overlaid on others, so the artwork keeps its content well inside
 * the frame and puts nothing important in the corners.
 */
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'store-assets');

/**
 * The mark is lifted straight out of the app icon rather than redrawn here, so
 * the listing artwork can never drift from what the launcher shows.
 */
const iconSvg = readFileSync(join(root, 'public', 'icons', 'icon.svg'), 'utf8');

const lift = (label, re) => {
  const found = iconSvg.match(re);
  if (!found) throw new Error(`could not lift the ${label} out of public/icons/icon.svg`);
  return found[0];
};

const markGradients = ['gold', 'teal', 'blade']
  .map((id) => lift(`${id} gradient`, new RegExp(`<linearGradient id="${id}"[\\s\\S]*?</linearGradient>`)))
  .join('\n    ');
const markGroup = lift('mark', /<g id="mark">[\s\S]*?<\/g>/);

const featureGraphic = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500" width="1024" height="500">
  <defs>
    ${markGradients}
    <linearGradient id="fg-bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1024" y2="500">
      <stop offset="0" stop-color="#12314f"/>
      <stop offset="0.5" stop-color="#0c2037"/>
      <stop offset="1" stop-color="#071522"/>
    </linearGradient>
    <radialGradient id="fg-glow" gradientUnits="userSpaceOnUse" cx="245" cy="250" r="270">
      <stop offset="0" stop-color="#1fbfae" stop-opacity="0.20"/>
      <stop offset="1" stop-color="#1fbfae" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1024" height="500" fill="url(#fg-bg)"/>
  <rect width="1024" height="500" fill="url(#fg-glow)"/>

  <!-- The app icon's own mark, so the listing and the launcher agree. -->
  <g transform="translate(245 250) scale(0.78) translate(-256 -256)">
    ${markGroup}
  </g>

  <g font-family="Segoe UI, Selawik, DejaVu Sans, Arial, sans-serif">
    <text x="425" y="222" fill="url(#gold)" font-size="76" font-weight="600" letter-spacing="13">ARARAT</text>
    <text x="429" y="282" fill="#35c9b8" font-size="30" font-weight="600" letter-spacing="0.5">Management Platform</text>
    <text x="429" y="341" fill="#9fb3c8" font-size="25" font-weight="400">Assets, SACCOs, KYC, payments</text>
    <text x="429" y="377" fill="#9fb3c8" font-size="25" font-weight="400">and e-signature in one portal.</text>
  </g>
</svg>`;

mkdirSync(outDir, { recursive: true });

// Flattened: Play rejects transparency on both of these.
await sharp(Buffer.from(featureGraphic))
  .flatten({ background: '#0c2037' })
  .png({ compressionLevel: 9 })
  .toFile(join(outDir, 'feature-graphic-1024x500.png'));
console.log('wrote store-assets/feature-graphic-1024x500.png');
