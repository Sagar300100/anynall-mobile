// Tiny vector-drawing helpers for the Any&All seller illustrations.
//
// jimp-compact has no shape primitives, so these paint into its raw bitmap.
// Everything is drawn at SCALE and downsampled by the caller, which is what
// makes the rounded corners and circles come out anti-aliased.
//
// Colours are alpha-blended over whatever is already there, so illustrations
// can be layered back-to-front like any other vector artwork.

/** Supersampling factor — draw big, resize down, get free anti-aliasing. */
export const SCALE = 3;

export const rgba = (r, g, b, a = 1) => ({ r, g, b, a });

/** The shared Any&All illustration palette. */
export const PALETTE = {
  cardBody: rgba(16, 33, 68, 1),
  cardEdge: rgba(90, 150, 255, 0.5),
  backCard: rgba(120, 175, 255, 0.45),
  backCardBody: rgba(38, 88, 190, 0.62),
  bandTint: rgba(46, 107, 255, 0.16),
  barStrong: rgba(150, 195, 255, 0.85),
  barMid: rgba(150, 195, 255, 0.5),
  barFaint: rgba(150, 195, 255, 0.28),
  accent: rgba(46, 107, 255, 1),
  accentSoft: rgba(94, 160, 255, 0.22),
  paper: rgba(160, 200, 255, 0.9),
  white: rgba(255, 255, 255, 1),
  shadow: rgba(9, 20, 44, 1),
};

/** Blend `col` over the pixel already at (x, y) in device (scaled) space. */
function blend(img, x, y, col) {
  const { width, height, data } = img.bitmap;
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = width * 4 * y + x * 4;
  const sa = col.a;
  const da = data[idx + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  data[idx] = Math.round((col.r * sa + data[idx] * da * (1 - sa)) / oa);
  data[idx + 1] = Math.round((col.g * sa + data[idx + 1] * da * (1 - sa)) / oa);
  data[idx + 2] = Math.round((col.b * sa + data[idx + 2] * da * (1 - sa)) / oa);
  data[idx + 3] = Math.round(oa * 255);
}

/** Rounded rectangle in unscaled coordinates. */
export function roundRect(img, x, y, w, h, r, col) {
  const x0 = Math.round(x * SCALE);
  const y0 = Math.round(y * SCALE);
  const w0 = Math.round(w * SCALE);
  const h0 = Math.round(h * SCALE);
  const r0 = Math.round(r * SCALE);
  for (let py = y0; py < y0 + h0; py++) {
    for (let px = x0; px < x0 + w0; px++) {
      // Clamp to the nearest corner centre; outside its radius = outside the box.
      const cx = Math.min(Math.max(px, x0 + r0), x0 + w0 - 1 - r0);
      const cy = Math.min(Math.max(py, y0 + r0), y0 + h0 - 1 - r0);
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > r0 * r0) continue;
      blend(img, px, py, col);
    }
  }
}

export function circle(img, cx, cy, radius, col) {
  const cx0 = cx * SCALE;
  const cy0 = cy * SCALE;
  const r0 = radius * SCALE;
  for (let py = Math.floor(cy0 - r0); py <= Math.ceil(cy0 + r0); py++) {
    for (let px = Math.floor(cx0 - r0); px <= Math.ceil(cx0 + r0); px++) {
      const dx = px - cx0;
      const dy = py - cy0;
      if (dx * dx + dy * dy > r0 * r0) continue;
      blend(img, px, py, col);
    }
  }
}

/** Ring / outlined circle. */
export function ring(img, cx, cy, radius, thickness, col) {
  const inner = radius - thickness;
  const cx0 = cx * SCALE;
  const cy0 = cy * SCALE;
  const r0 = radius * SCALE;
  const i0 = inner * SCALE;
  for (let py = Math.floor(cy0 - r0); py <= Math.ceil(cy0 + r0); py++) {
    for (let px = Math.floor(cx0 - r0); px <= Math.ceil(cx0 + r0); px++) {
      const d2 = (px - cx0) ** 2 + (py - cy0) ** 2;
      if (d2 > r0 * r0 || d2 < i0 * i0) continue;
      blend(img, px, py, col);
    }
  }
}

/** Filled triangle, in unscaled coordinates. Barycentric point-in-triangle
 *  over the bounding box — used for the bank pediment. */
export function triangle(img, ax, ay, bx, by, cx, cy, col) {
  const p = [
    [ax * SCALE, ay * SCALE],
    [bx * SCALE, by * SCALE],
    [cx * SCALE, cy * SCALE],
  ];
  const minX = Math.floor(Math.min(p[0][0], p[1][0], p[2][0]));
  const maxX = Math.ceil(Math.max(p[0][0], p[1][0], p[2][0]));
  const minY = Math.floor(Math.min(p[0][1], p[1][1], p[2][1]));
  const maxY = Math.ceil(Math.max(p[0][1], p[1][1], p[2][1]));
  const d = (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][1] - p[2][1]);
  if (d === 0) return;
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const l1 = ((p[1][1] - p[2][1]) * (px - p[2][0]) + (p[2][0] - p[1][0]) * (py - p[2][1])) / d;
      const l2 = ((p[2][1] - p[0][1]) * (px - p[2][0]) + (p[0][0] - p[2][0]) * (py - p[2][1])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      blend(img, px, py, col);
    }
  }
}

/** Four-pointed sparkle — the small accent dots around hero artwork. */
export function sparkle(img, cx, cy, r, col) {
  triangle(img, cx, cy - r, cx - r * 0.34, cy, cx + r * 0.34, cy, col);
  triangle(img, cx, cy + r, cx - r * 0.34, cy, cx + r * 0.34, cy, col);
  triangle(img, cx - r, cy, cx, cy - r * 0.34, cx, cy + r * 0.34, col);
  triangle(img, cx + r, cy, cx, cy - r * 0.34, cx, cy + r * 0.34, col);
}

/** Thick round-capped line segment — check marks, slashes, connectors. */
export function segment(img, ax, ay, bx, by, thickness, col) {
  const x1 = ax * SCALE;
  const y1 = ay * SCALE;
  const x2 = bx * SCALE;
  const y2 = by * SCALE;
  const t = (thickness * SCALE) / 2;
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy;
  for (let py = Math.floor(Math.min(y1, y2) - t); py <= Math.ceil(Math.max(y1, y2) + t); py++) {
    for (let px = Math.floor(Math.min(x1, x2) - t); px <= Math.ceil(Math.max(x1, x2) + t); px++) {
      const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - x1) * vx + (py - y1) * vy) / len2));
      const dx = px - (x1 + u * vx);
      const dy = py - (y1 + u * vy);
      if (dx * dx + dy * dy > t * t) continue;
      blend(img, px, py, col);
    }
  }
}

/** The blue "verified" disc used across the seller illustrations. */
export function checkBadge(img, cx, cy, r) {
  circle(img, cx, cy, r + 4, PALETTE.shadow);
  circle(img, cx, cy, r, PALETTE.accent);
  segment(img, cx - 0.4 * r, cy + 0.03 * r, cx - 0.1 * r, cy + 0.33 * r, r * 0.22, PALETTE.white);
  segment(img, cx - 0.1 * r, cy + 0.33 * r, cx + 0.47 * r, cy - 0.32 * r, r * 0.22, PALETTE.white);
}

/** A geometric per-cent mark: two rings and a slash. No font needed. */
export function percentMark(img, cx, cy, size, col) {
  const r = size * 0.18;
  ring(img, cx - size * 0.28, cy - size * 0.26, r, r * 0.5, col);
  ring(img, cx + size * 0.28, cy + size * 0.26, r, r * 0.5, col);
  segment(img, cx + size * 0.34, cy - size * 0.4, cx - size * 0.34, cy + size * 0.4, size * 0.12, col);
}

/** Soft ambient glow so artwork doesn't sit flat on the navy background. */
export function glow(img, cx, cy, radius) {
  for (let i = 12; i >= 1; i--) circle(img, cx, cy, radius + i * 4, rgba(46, 107, 255, 0.012));
}
