/**
 * Generate PWA icons from favicon.svg at various sizes.
 * Usage: node scripts/generate-pwa-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SVG_PATH = join(root, 'public', 'favicon.svg');
const OUT_DIR = join(root, 'public', 'icons');

const SIZES = [16, 32, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512];

// Map size to filename
const FILE_NAMES = {
  16: 'favicon-16x16.png',
  32: 'favicon-32x32.png',
  96: 'favicon-96x96.png',
  128: 'favicon-128x128.png',
  144: 'ms-icon-144x144.png',
  152: 'apple-icon-152x152.png',
  167: 'apple-icon-167x167.png',
  180: 'apple-icon-180x180.png',
  192: 'icon-192x192.png',
  256: 'icon-256x256.png',
  384: 'icon-384x384.png',
  512: 'icon-512x512.png',
};

async function main() {
  // Dynamic import of sharp (ESM-compatible)
  const sharp = (await import('sharp')).default;

  const svgBuffer = readFileSync(SVG_PATH);
  mkdirSync(OUT_DIR, { recursive: true });

  for (const size of SIZES) {
    const name = FILE_NAMES[size];
    if (!name) continue;

    const outPath = join(OUT_DIR, name);

    // sharp needs density for SVG rasterization
    // SVG viewBox is 48x48, so density = size / 48 * 72
    const density = Math.round((size / 48) * 72);

    await sharp(svgBuffer, { density })
      .resize(size, size)
      .png()
      .toFile(outPath);

    console.log(`✓ ${name} (${size}x${size})`);
  }

  console.log('\nDone! All PWA icons generated.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
