// One-time dev script: split the approved category-artwork collage
// (assets/source/category-collage.png, 8×5 tiles) into individual square
// category assets under assets/categories/<slug>.png.
//
// Only tiles matching REAL categories in src/lib/categories.ts are extracted —
// collage-only categories (Watches, Furniture, Kitchen & Dining, …) are
// deliberately skipped because they don't exist in the approved taxonomy.
// Crops take the illustrated object zone only (tile label and border are
// excluded). Also writes a contact sheet to assets/source/qa-contact-sheet.png
// for one-glance QA of every crop.
//
// Run:  node scripts/extract-category-art.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Jimp = require('jimp-compact');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'assets', 'source', 'category-collage.png');
const OUT_DIR = path.join(root, 'assets', 'categories');
const QA = path.join(root, 'assets', 'source', 'qa-contact-sheet.png');

// Collage grid geometry, measured on the 1536×1024 original and scaled to the
// actual file dimensions at runtime.
const REF_W = 1536;
const GRID = { left: 57, top: 66, colW: 177.6, rowH: 187.2 };
// Object zone: the FULL tile interior between the tile border and the label
// band — a fixed square window clips wide objects (sneaker, gramophone), so
// instead the whole safe rect is taken and centred on a padded square canvas
// whose fill is sampled from that tile's own background.
const RECT = { x0: 0.065, x1: 0.855, y0: 0.075, y1: 0.705 }; // fractions of colW/rowH
const CANVAS_PAD = 16; // px of breathing room added around the rect
const CORNER_PATCH = 15; // px — overpaint tile-border corner arcs (never object)

// (row, col) → real category slug. Rows/cols are 0-indexed.
const TILES = [
  [0, 0, 'trading-card-games'],
  [0, 1, 'sports-cards'],
  [0, 2, 'coins-money'],
  [0, 3, 'sneakers-streetwear'],
  // [0,4] "Watches" — not a real category, skipped
  [0, 5, 'bags-accessories'],
  [0, 6, 'mens-fashion'],
  [0, 7, 'womens-fashion'],
  [1, 0, 'electronics'],
  [1, 1, 'video-games'],
  [1, 2, 'collectibles'],
  [1, 3, 'comics'],
  [1, 4, 'anime-manga'],
  [1, 5, 'books-movies'],
  [1, 6, 'toys-hobbies'],
  [1, 7, 'arts-handmade'],
  [2, 0, 'beauty'],
  [2, 1, 'jewelry'], // collage "Jewellery & Watches" → real category "Jewelry"
  [2, 2, 'home-garden'],
  // Approved-artwork reuse for real categories the collage has no direct
  // tile for (mapping is curation of approved art, not invented content):
  // {thr}: vivid object on a faint backdrop panel — high threshold locks the
  // bounding box onto the object and leaves the panel behind.
  // {full}: dark object that can't be thresholded — take the whole tile
  // interior with a wide feather instead of bbox detection.
  [2, 3, 'home-decor', { thr: 120 }], // collage "Furniture" armchair → "Home Decor"
  [2, 4, 'food-drink', { thr: 120 }], // collage "Kitchen & Dining" pot → "Food & Drink"
  [2, 5, 'baby-kids'],
  [2, 6, 'pets'], // collage "Pet Supplies" → real category "Pets"
  [2, 7, 'sporting-goods', { full: true }], // collage "Health & Wellness" watch → "Sporting Goods"
  [3, 0, 'music'],
  // [3,1..3] Cameras / Audio / Car & Motorbike — not real categories, skipped
  [3, 4, 'sports-memorabilia'],
  [3, 5, 'outdoor-gear', { full: true }], // collage "Outdoor & Camping" → "Outdoor Gear"
  // [3,6] Tools — not a real category, skipped
  [3, 7, 'art'], // collage "Office & Stationery" brushes/pens → real "Art"
  // Bottom collage row sits a few px lower — nudge these crops down so the
  // tile's inner top border stays out of frame.
  [4, 0, 'vintage-antiques', { y: 0.03 }],
  [4, 1, 'knives-hunting', { y: 0.03, full: true }], // "Military Collectibles" → "Knives & Hunting"
  [4, 2, 'fashion', { y: 0.03, thr: 110 }], // collage "Luxury Items" bag → "Fashion"
  // [4,3..6] Perfume / Wine / Local Deals / Wholesale — skipped
  // {sub}: surgical sub-window (fractions of the rect) for art whose backdrop
  // panel is brighter than any usable threshold — crop straight to the object.
  [4, 7, 'any-all-exclusives', { full: true, sub: [0.24, 0.05, 0.83, 0.95] }],
];

const collage = await Jimp.read(SRC);
const scale = collage.bitmap.width / REF_W;

const sheetCols = 5;
const cell = 128;
const rows = Math.ceil(TILES.length / sheetCols);
const sheet = new Jimp(sheetCols * cell, rows * cell, 0xff0a1024);

/** Average the four inset corners of a rect — the tile's own background. */
function cornerColor(img, x, y, w, h) {
  const pts = [
    [x + 3, y + 3],
    [x + w - 4, y + 3],
    [x + 3, y + h - 4],
    [x + w - 4, y + h - 4],
  ];
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (const [px, py] of pts) {
    const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(px, py));
    rSum += r;
    gSum += g;
    bSum += b;
  }
  return Jimp.rgbaToInt(Math.round(rSum / 4), Math.round(gSum / 4), Math.round(bSum / 4), 255);
}

// Output contract (strict): 512×512 PNG on the exact app navy (#010F27),
// object bounds DETECTED per tile, object scaled to a uniform ≤68% of the
// canvas, centred, ≥16% clear space on every side. Nothing can touch an edge
// and no tile border/label can survive, by construction.
const OUT_SIZE = 512;
const OBJECT_MAX = Math.round(OUT_SIZE * 0.68); // 348px — uniform object size
const APP_NAVY = Jimp.rgbaToInt(1, 15, 39, 255); // #010F27, matches ART_BG

let i = 0;
for (const [r, c, slug, opts = {}] of TILES) {
  const yShift = opts.y ?? 0;
  const thr = opts.thr ?? 66;
  const tileX = (GRID.left + c * GRID.colW) * scale;
  const tileY = (GRID.top + r * GRID.rowH) * scale;
  const x = Math.round(tileX + RECT.x0 * GRID.colW * scale);
  const y = Math.round(tileY + (RECT.y0 + yShift) * GRID.rowH * scale);
  const w = Math.round((RECT.x1 - RECT.x0) * GRID.colW * scale);
  const h = Math.round((RECT.y1 - RECT.y0) * GRID.rowH * scale);

  let rect = collage.clone().crop(x, y, w, h);
  const fill = cornerColor(collage, x, y, w, h);
  const fillRGB = Jimp.intToRGBA(fill);

  if (!opts.full) {
    // Erase the source tile's border remnants ON THE RAW CROP: corner arcs
    // and thin edge segments get overpainted with the tile's background.
    // (Full-tile mode must NOT do this — the patch seams would be baked into
    // the visible area; its wide feather erases the borders instead.)
    const cp = Math.round(CORNER_PATCH * scale);
    const patch = new Jimp(cp, cp, fill);
    rect.composite(patch, 0, 0);
    rect.composite(patch, w - cp, 0);
    rect.composite(patch, 0, h - cp);
    rect.composite(patch, w - cp, h - cp);
    const es = Math.max(2, Math.round(3 * scale));
    rect.composite(new Jimp(es, h, fill), 0, 0);
    rect.composite(new Jimp(es, h, fill), w - es, 0);
    rect.composite(new Jimp(w, es, fill), 0, 0);
  }

  // Optional surgical sub-window before any detection.
  let sw = w;
  let sh = h;
  if (opts.sub) {
    const [fx0, fy0, fx1, fy1] = opts.sub;
    const sx = Math.round(w * fx0);
    const sy = Math.round(h * fy0);
    sw = Math.round(w * (fx1 - fx0));
    sh = Math.round(h * (fy1 - fy0));
    rect = rect.crop(sx, sy, sw, sh);
  }

  let minX;
  let minY;
  let maxX;
  let maxY;
  if (opts.full) {
    // Dark object on a drawn backdrop — bbox detection can't separate them,
    // so take the whole interior; the wide feather below hides the edges.
    minX = 0;
    minY = 0;
    maxX = sw - 1;
    maxY = sh - 1;
  } else {
    // Detect the object's true bounding box: pixels that differ meaningfully
    // from the tile background. Guarantees the whole object is captured.
    minX = sw;
    minY = sh;
    maxX = -1;
    maxY = -1;
    rect.scan(0, 0, sw, sh, function scan(px, py, idx) {
      const dr = Math.abs(this.bitmap.data[idx] - fillRGB.r);
      const dg = Math.abs(this.bitmap.data[idx + 1] - fillRGB.g);
      const db = Math.abs(this.bitmap.data[idx + 2] - fillRGB.b);
      if (dr + dg + db > thr) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    });
    if (maxX < 0) {
      // Defensive: nothing detected (should never happen) — use the full rect.
      minX = 0;
      minY = 0;
      maxX = sw - 1;
      maxY = sh - 1;
    }
  }

  // Expand the box a little so anti-aliased object edges and their soft
  // shadows come along, then lift it out of the rect.
  const PADN = 8;
  const bx = Math.max(0, minX - PADN);
  const by = Math.max(0, minY - PADN);
  const bw = Math.min(sw, maxX + PADN + 1) - bx;
  const bh = Math.min(sh, maxY + PADN + 1) - by;
  const obj = rect.clone().crop(bx, by, bw, bh);

  // Uniform normalisation: every object's longest side becomes exactly
  // OBJECT_MAX px on the 512 canvas → consistent scale across all categories,
  // ≥16% guaranteed margin on every side.
  const s = OBJECT_MAX / Math.max(bw, bh);
  const nw = Math.max(1, Math.round(bw * s));
  const nh = Math.max(1, Math.round(bh * s));
  obj.resize(nw, nh, Jimp.RESIZE_BICUBIC);

  // Feather only the outer fringe of the lifted patch (background fringe,
  // not the object — the PADN margin keeps the object inside the ring), so
  // the patch melts into the canvas navy with no visible seam. Full-tile
  // patches feather much wider to swallow backdrop and border remnants.
  const fe = opts.full
    ? Math.round(Math.min(nw, nh) * 0.18)
    : Math.max(8, Math.round(PADN * s * 0.9));
  obj.scan(0, 0, nw, nh, function feather(px, py, idx) {
    const d = Math.min(px, py, nw - 1 - px, nh - 1 - py);
    if (d < fe) {
      const t = d / fe;
      const ease = t * t * (3 - 2 * t);
      this.bitmap.data[idx + 3] = Math.round(this.bitmap.data[idx + 3] * ease);
    }
  });

  const canvas = new Jimp(OUT_SIZE, OUT_SIZE, APP_NAVY);
  canvas.composite(obj, Math.round((OUT_SIZE - nw) / 2), Math.round((OUT_SIZE - nh) / 2));
  await canvas.writeAsync(path.join(OUT_DIR, `${slug}.png`));

  sheet.composite(canvas.clone().resize(cell, cell), (i % sheetCols) * cell, Math.floor(i / sheetCols) * cell);
  i += 1;
}

await sheet.writeAsync(QA);
console.log(`extracted ${TILES.length} assets → assets/categories/, QA sheet → ${path.basename(QA)}`);
