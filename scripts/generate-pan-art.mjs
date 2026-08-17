// Generates the abstract PAN / tax-identity illustration used on seller
// onboarding step 4 (src/components/pan-details-screen.tsx).
//
// Deliberately NOT a PAN card replica: no government emblem, no Income Tax
// Department wordmark, no QR code, no PAN number, no hologram. It is a
// generic layered identity card — avatar block, redacted text bars and a
// verification badge — drawn in the Any&All blue/navy palette.
//
// Run: node scripts/generate-pan-art.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const Jimp = createRequire(import.meta.url)('jimp-compact');

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'seller',
  'pan-card.png',
);

// Draw at 3x and downsample so every rounded edge lands anti-aliased.
const S = 3;
const W = 360 * S;
const H = 240 * S;

const rgba = (r, g, b, a = 1) => ({ r, g, b, a });

/** Blend `col` over the pixel already at (x, y). */
function blend(img, x, y, col) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const idx = img.bitmap.width * 4 * y + x * 4;
  const d = img.bitmap.data;
  const sa = col.a;
  const da = d[idx + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  d[idx] = Math.round((col.r * sa + d[idx] * da * (1 - sa)) / oa);
  d[idx + 1] = Math.round((col.g * sa + d[idx + 1] * da * (1 - sa)) / oa);
  d[idx + 2] = Math.round((col.b * sa + d[idx + 2] * da * (1 - sa)) / oa);
  d[idx + 3] = Math.round(oa * 255);
}

function roundRect(img, x, y, w, h, r, col) {
  const x0 = Math.round(x * S);
  const y0 = Math.round(y * S);
  const w0 = Math.round(w * S);
  const h0 = Math.round(h * S);
  const r0 = Math.round(r * S);
  for (let py = y0; py < y0 + h0; py++) {
    for (let px = x0; px < x0 + w0; px++) {
      // Corner test: distance from the nearest corner centre.
      const cx = Math.min(Math.max(px, x0 + r0), x0 + w0 - 1 - r0);
      const cy = Math.min(Math.max(py, y0 + r0), y0 + h0 - 1 - r0);
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > r0 * r0) continue;
      blend(img, px, py, col);
    }
  }
}

function circle(img, cx, cy, radius, col) {
  const cx0 = cx * S;
  const cy0 = cy * S;
  const r0 = radius * S;
  for (let py = Math.floor(cy0 - r0); py <= Math.ceil(cy0 + r0); py++) {
    for (let px = Math.floor(cx0 - r0); px <= Math.ceil(cx0 + r0); px++) {
      const dx = px - cx0;
      const dy = py - cy0;
      if (dx * dx + dy * dy > r0 * r0) continue;
      blend(img, px, py, col);
    }
  }
}

/** Thick round-capped line, used for the check mark. */
function segment(img, ax, ay, bx, by, thickness, col) {
  const x1 = ax * S;
  const y1 = ay * S;
  const x2 = bx * S;
  const y2 = by * S;
  const t = (thickness * S) / 2;
  const minX = Math.floor(Math.min(x1, x2) - t);
  const maxX = Math.ceil(Math.max(x1, x2) + t);
  const minY = Math.floor(Math.min(y1, y2) - t);
  const maxY = Math.ceil(Math.max(y1, y2) + t);
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy;
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - x1) * vx + (py - y1) * vy) / len2));
      const dx = px - (x1 + u * vx);
      const dy = py - (y1 + u * vy);
      if (dx * dx + dy * dy > t * t) continue;
      blend(img, px, py, col);
    }
  }
}

const img = new Jimp(W, H, 0x00000000);

// --- Soft ambient glow behind the stack -----------------------------------
for (let i = 12; i >= 1; i--) {
  circle(img, 178, 118, 60 + i * 4, rgba(46, 107, 255, 0.012));
}

// --- Back card (offset, faded) --------------------------------------------
roundRect(img, 66, 28, 244, 132, 20, rgba(120, 175, 255, 0.45));
roundRect(img, 69, 31, 238, 126, 18, rgba(38, 88, 190, 0.62));

// --- Front card ------------------------------------------------------------
roundRect(img, 34, 62, 258, 148, 22, rgba(90, 150, 255, 0.5)); // border ring
roundRect(img, 36, 64, 254, 144, 20, rgba(16, 33, 68, 1)); // body
roundRect(img, 36, 64, 254, 46, 20, rgba(46, 107, 255, 0.16)); // header band
roundRect(img, 36, 100, 254, 12, 0, rgba(16, 33, 68, 1)); // square off the band

// Header band accent bars (abstract "label" text, unreadable by design).
roundRect(img, 54, 78, 84, 9, 4.5, rgba(150, 195, 255, 0.85));
roundRect(img, 146, 78, 40, 9, 4.5, rgba(150, 195, 255, 0.4));

// --- Avatar block ----------------------------------------------------------
roundRect(img, 54, 120, 64, 66, 14, rgba(94, 160, 255, 0.22));
circle(img, 86, 146, 13, rgba(160, 200, 255, 0.9));
roundRect(img, 66, 162, 40, 26, 13, rgba(160, 200, 255, 0.9));

// --- Redacted detail bars --------------------------------------------------
roundRect(img, 132, 124, 122, 11, 5.5, rgba(150, 195, 255, 0.75));
roundRect(img, 132, 146, 96, 11, 5.5, rgba(150, 195, 255, 0.45));
roundRect(img, 132, 168, 132, 11, 5.5, rgba(46, 107, 255, 0.9)); // the PAN row
roundRect(img, 132, 190, 62, 8, 4, rgba(150, 195, 255, 0.28));

// --- Verified badge --------------------------------------------------------
circle(img, 276, 190, 32, rgba(9, 20, 44, 1));
circle(img, 276, 190, 28, rgba(46, 107, 255, 1));
segment(img, 265, 191, 273, 199, 6, rgba(255, 255, 255, 1));
segment(img, 273, 199, 289, 181, 6, rgba(255, 255, 255, 1));

img.resize(360, 240, Jimp.RESIZE_BICUBIC);
await img.writeAsync(OUT);
console.log('wrote', OUT);
