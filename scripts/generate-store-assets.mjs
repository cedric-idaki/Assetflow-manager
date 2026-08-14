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
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'store-assets');

const featureGraphic = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500" width="1024" height="500">
  <defs>
    <linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1024" y2="500">
      <stop offset="0" stop-color="#12314f"/>
      <stop offset="0.5" stop-color="#0c2037"/>
      <stop offset="1" stop-color="#071522"/>
    </linearGradient>
    <radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="245" cy="250" r="260">
      <stop offset="0" stop-color="#34c1dd" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#34c1dd" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mark" gradientUnits="userSpaceOnUse" x1="150" y1="140" x2="330" y2="360">
      <stop offset="0" stop-color="#6fdff2"/>
      <stop offset="1" stop-color="#34c1dd"/>
    </linearGradient>
  </defs>

  <rect width="1024" height="500" fill="url(#bg)"/>
  <rect width="1024" height="500" fill="url(#glow)"/>

  <!-- The same A as the app icon, so the listing and the launcher agree. -->
  <g fill="none" stroke="url(#mark)" stroke-linecap="round" stroke-linejoin="round"
     transform="translate(245 250) scale(0.62) translate(-256 -256)">
    <path d="M128 390 L256 138 L384 390" stroke-width="54"/>
    <path d="M186 316 H326" stroke-width="46"/>
  </g>

  <g font-family="Segoe UI, Selawik, DejaVu Sans, Arial, sans-serif">
    <text x="410" y="228" fill="#ffffff" font-size="86" font-weight="700" letter-spacing="-1.5">Ararat</text>
    <text x="413" y="286" fill="#7fd7e8" font-size="30" font-weight="600" letter-spacing="0.5">Management Platform</text>
    <text x="413" y="345" fill="#9fb3c8" font-size="25" font-weight="400">Assets, SACCOs, KYC, payments</text>
    <text x="413" y="381" fill="#9fb3c8" font-size="25" font-weight="400">and e-signature in one portal.</text>
  </g>
</svg>`;

mkdirSync(outDir, { recursive: true });

// Flattened: Play rejects transparency on both of these.
await sharp(Buffer.from(featureGraphic))
  .flatten({ background: '#0c2037' })
  .png({ compressionLevel: 9 })
  .toFile(join(outDir, 'feature-graphic-1024x500.png'));
console.log('wrote store-assets/feature-graphic-1024x500.png');
