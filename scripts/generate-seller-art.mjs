// Generates the seller-onboarding hero illustrations for Steps 5 and 6.
//
//   assets/seller/enrolment.png       unregistered — GST-portal enrolment
//   assets/seller/gst-composition.png composition taxpayer
//   assets/seller/gst-regular.png     regular GST-registered business
//   assets/seller/bank.png            bank account for payouts
//
// All are abstract Any&All artwork: no government emblem, no bank logo, no GST or
// Income Tax Department branding, no certificate replica, no QR code, no real
// registration number, and no baked text of any kind (so they never need
// translating and never render a wrong value).
//
// Run: node scripts/generate-seller-art.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  SCALE, PALETTE, rgba, roundRect, circle, ring, segment, triangle, sparkle,
  checkBadge, percentMark, glow,
} from './lib/draw-blue.mjs';

const Jimp = createRequire(import.meta.url)('jimp-compact');

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'seller');
const W = 360;
const H = 240;

const canvas = () => new Jimp(W * SCALE, H * SCALE, 0x00000000);

async function save(img, name) {
  img.resize(W, H, Jimp.RESIZE_BICUBIC);
  const out = path.join(OUT_DIR, name);
  await img.writeAsync(out);
  console.log('wrote', out);
}

/** Shared body: a document sheet with a folded corner and ruled lines. */
function documentSheet(img, x, y, w, h) {
  const fold = 34;
  // Sheet.
  roundRect(img, x - 2, y - 2, w + 4, h + 4, 16, PALETTE.cardEdge);
  roundRect(img, x, y, w, h, 14, PALETTE.cardBody);
  // Folded top-right corner, faked with a lighter wedge.
  for (let i = 0; i < fold; i++) {
    roundRect(img, x + w - fold + i, y + i, fold - i, 1, 0, rgba(120, 175, 255, 0.5));
  }
  roundRect(img, x + w - fold, y, fold, 2, 0, PALETTE.cardBody);
  // Ruled content.
  const lines = [
    { dy: 34, wf: 0.52, col: PALETTE.barStrong },
    { dy: 56, wf: 0.72, col: PALETTE.barMid },
    { dy: 78, wf: 0.62, col: PALETTE.barMid },
    { dy: 100, wf: 0.78, col: PALETTE.accent },
    { dy: 122, wf: 0.44, col: PALETTE.barFaint },
  ];
  for (const l of lines) roundRect(img, x + 18, y + l.dy, (w - 36) * l.wf, 10, 5, l.col);
}

// ── 1. Unregistered enrolment ──────────────────────────────────────────────
// A single application document, stamped. Reads as "a form you obtain and
// submit", which is exactly what the GST-portal enrolment number is.
{
  const img = canvas();
  glow(img, 180, 120, 66);
  // Ghost sheet behind, for depth.
  roundRect(img, 118, 26, 150, 176, 14, rgba(120, 175, 255, 0.28));
  roundRect(img, 121, 29, 144, 170, 12, PALETTE.backCardBody);
  documentSheet(img, 78, 44, 168, 168);
  checkBadge(img, 248, 186, 30);
  await save(img, 'enrolment.png');
}

// ── 2. Composition taxpayer ────────────────────────────────────────────────
// Registration document plus a per-cent mark: composition is a flat-rate
// scheme, and the % reads as "rate" without spelling anything out.
{
  const img = canvas();
  glow(img, 178, 118, 62);
  roundRect(img, 74, 30, 232, 138, 18, rgba(120, 175, 255, 0.4));
  roundRect(img, 77, 33, 226, 132, 16, PALETTE.backCardBody);
  // Front card.
  roundRect(img, 40, 62, 240, 146, 20, PALETTE.cardEdge);
  roundRect(img, 42, 64, 236, 142, 18, PALETTE.cardBody);
  roundRect(img, 42, 64, 236, 42, 18, PALETTE.bandTint);
  roundRect(img, 42, 98, 236, 10, 0, PALETTE.cardBody);
  roundRect(img, 60, 76, 76, 9, 4.5, PALETTE.barStrong);
  // Avatar block + detail bars.
  roundRect(img, 60, 118, 56, 60, 13, PALETTE.accentSoft);
  circle(img, 88, 141, 12, PALETTE.paper);
  roundRect(img, 70, 156, 36, 24, 12, PALETTE.paper);
  roundRect(img, 132, 122, 118, 10, 5, PALETTE.barStrong);
  roundRect(img, 132, 142, 92, 10, 5, PALETTE.barMid);
  roundRect(img, 132, 162, 128, 10, 5, PALETTE.accent);
  roundRect(img, 132, 182, 58, 8, 4, PALETTE.barFaint);
  // Per-cent disc.
  circle(img, 276, 188, 36, PALETTE.shadow);
  circle(img, 276, 188, 32, PALETTE.accent);
  percentMark(img, 276, 188, 30, PALETTE.white);
  await save(img, 'gst-composition.png');
}

// ── 3. Regular GST-registered ──────────────────────────────────────────────
// A business premises rather than a document: regular registration is the
// "established business" tier, and it distinguishes the two GST screens at a
// glance without either one needing a label.
{
  const img = canvas();
  glow(img, 176, 120, 66);
  // Back tower.
  roundRect(img, 196, 52, 92, 158, 12, rgba(120, 175, 255, 0.4));
  roundRect(img, 199, 55, 86, 152, 10, PALETTE.backCardBody);
  for (let r = 0; r < 5; r++) {
    for (let cIdx = 0; cIdx < 3; cIdx++) {
      roundRect(img, 211 + cIdx * 22, 70 + r * 26, 14, 16, 3, rgba(150, 195, 255, 0.45));
    }
  }
  // Front block.
  roundRect(img, 62, 78, 150, 132, 14, PALETTE.cardEdge);
  roundRect(img, 64, 80, 146, 128, 12, PALETTE.cardBody);
  roundRect(img, 64, 80, 146, 26, 12, PALETTE.bandTint);
  roundRect(img, 64, 98, 146, 8, 0, PALETTE.cardBody);
  for (let r = 0; r < 3; r++) {
    for (let cIdx = 0; cIdx < 4; cIdx++) {
      const lit = (r + cIdx) % 3 === 0;
      roundRect(img, 80 + cIdx * 30, 118 + r * 28, 20, 20, 4,
        lit ? PALETTE.accent : rgba(150, 195, 255, 0.42));
    }
  }
  // Doorway, so it reads as premises not a spreadsheet.
  roundRect(img, 124, 186, 26, 24, 6, PALETTE.paper);
  // Ground line.
  roundRect(img, 44, 210, 250, 4, 2, rgba(150, 195, 255, 0.3));
  checkBadge(img, 274, 190, 30);
  await save(img, 'gst-regular.png');
}


// ── 4. Bank account (Step 6) ───────────────────────────────────────────────
// Classical bank facade: filled pediment with a dark tympanum and an oculus,
// architrave, fluted columns, stepped plinth, and a rupee coin overlapping the
// lower-right corner. Generic civic architecture — no real bank's name, logo
// or colours, and no passbook or statement replica.
{
  const img = canvas();
  glow(img, 168, 122, 74);

  const ROOF = rgba(96, 155, 255, 1);
  const ROOF_DARK = rgba(58, 110, 214, 1);
  const TYMPANUM = rgba(18, 36, 74, 1);
  const COLUMN = rgba(150, 195, 255, 0.92);
  const COLUMN_LIT = rgba(196, 222, 255, 0.95);
  const BASE = rgba(120, 175, 255, 1);
  const BASE_DARK = rgba(74, 130, 232, 1);

  // Pediment. The right half is a shade darker so the roof reads as a solid
  // volume catching light from the left rather than a flat triangle.
  triangle(img, 152, 34, 34, 92, 270, 92, ROOF);
  triangle(img, 152, 34, 270, 92, 200, 92, ROOF_DARK);
  // Tympanum + oculus.
  triangle(img, 152, 52, 62, 86, 242, 86, TYMPANUM);
  circle(img, 152, 74, 8, ROOF);

  // Architrave.
  roundRect(img, 36, 92, 234, 15, 5, BASE);
  roundRect(img, 36, 104, 234, 4, 2, BASE_DARK);

  // Four fluted columns, each with a lit left edge and a capital/base collar.
  for (let i = 0; i < 4; i++) {
    const x = 56 + i * 50;
    roundRect(img, x - 3, 110, 34, 7, 3, BASE);          // capital
    roundRect(img, x, 117, 28, 66, 6, COLUMN);           // shaft
    roundRect(img, x + 4, 117, 6, 66, 3, COLUMN_LIT);    // highlight
    roundRect(img, x - 3, 183, 34, 8, 3, BASE);          // base collar
  }

  // Stepped plinth.
  roundRect(img, 40, 191, 224, 14, 4, BASE);
  roundRect(img, 26, 205, 252, 14, 5, BASE_DARK);

  // Rupee coin, overlapping the lower-right corner of the facade.
  const cx = 268;
  const cy = 180;
  circle(img, cx, cy, 43, rgba(8, 18, 40, 1));
  circle(img, cx, cy, 38, PALETTE.accent);
  circle(img, cx, cy, 31, rgba(104, 160, 255, 1));
  // ₹ — two horizontal bars, a left stem, and the diagonal leg.
  const w = 5.5;
  segment(img, cx - 13, cy - 16, cx + 12, cy - 16, w, PALETTE.white);
  segment(img, cx - 13, cy - 6, cx + 12, cy - 6, w, PALETTE.white);
  segment(img, cx - 2, cy - 16, cx - 2, cy + 2, w, PALETTE.white);
  segment(img, cx - 2, cy + 2, cx - 13, cy + 2, w, PALETTE.white);
  segment(img, cx - 8, cy + 2, cx + 9, cy + 19, w, PALETTE.white);

  // Accent sparkles.
  sparkle(img, 54, 46, 9, rgba(150, 195, 255, 0.85));
  sparkle(img, 288, 58, 7, rgba(150, 195, 255, 0.6));
  sparkle(img, 22, 132, 6, rgba(150, 195, 255, 0.5));
  sparkle(img, 316, 118, 5, rgba(150, 195, 255, 0.45));

  await save(img, 'bank.png');
}

// ── 5. Seller Agreement (Step 7) ───────────────────────────────────────────
// A signed document with a verification shield. Abstract: the "signature" is
// a drawn squiggle, the ruled lines carry no text, and nothing imitates a
// real contract, seal or letterhead.
{
  const img = canvas();
  glow(img, 170, 120, 70);

  const PAPER = rgba(96, 155, 255, 1);
  const PAPER_DARK = rgba(52, 104, 208, 1);
  const RULE = rgba(210, 232, 255, 0.92);
  const RULE_SOFT = rgba(210, 232, 255, 0.55);

  // Sheet behind, peeking out to give the stack depth.
  roundRect(img, 118, 40, 148, 176, 12, PAPER_DARK);

  // Front sheet with a folded top-right corner.
  const x = 74;
  const y = 52;
  const w = 156;
  const h = 172;
  const fold = 34;
  roundRect(img, x, y, w, h, 12, PAPER);
  // Cut the corner away, then lay the darker fold triangle over it.
  triangle(img, x + w - fold, y - 1, x + w + 1, y - 1, x + w + 1, y + fold, rgba(0, 0, 0, 0));
  triangle(img, x + w - fold, y, x + w, y + fold, x + w - fold, y + fold, PAPER_DARK);

  // Ruled lines — deliberately meaningless, so nothing needs translating.
  const lines = [0.62, 0.82, 0.72, 0.86, 0.5];
  lines.forEach((f, i) => {
    roundRect(img, x + 18, y + 40 + i * 20, (w - 36) * f, 7, 3.5, i % 2 ? RULE_SOFT : RULE);
  });

  // Signature: a looped squiggle above a ruled signing line.
  const sy = y + 148;
  segment(img, x + 20, sy, x + 30, sy - 16, 4.5, RULE);
  segment(img, x + 30, sy - 16, x + 38, sy + 2, 4.5, RULE);
  segment(img, x + 38, sy + 2, x + 48, sy - 14, 4.5, RULE);
  segment(img, x + 48, sy - 14, x + 56, sy - 2, 4.5, RULE);
  roundRect(img, x + 62, sy - 4, 52, 4, 2, RULE_SOFT);

  // Verification shield, overlapping the lower-right corner.
  const shx = 258;
  const shy = 168;
  const shw = 74;
  const shh = 84;
  roundRect(img, shx - shw / 2, shy - shh / 2, shw, shh * 0.62, 14, rgba(30, 78, 176, 1));
  triangle(img, shx - shw / 2, shy + shh * 0.06, shx + shw / 2, shy + shh * 0.06, shx, shy + shh / 2, rgba(30, 78, 176, 1));
  // Inner face, inset so the shield reads as having a rim.
  roundRect(img, shx - shw / 2 + 7, shy - shh / 2 + 7, shw - 14, shh * 0.62 - 9, 10, PALETTE.accent);
  triangle(img, shx - shw / 2 + 7, shy + shh * 0.02, shx + shw / 2 - 7, shy + shh * 0.02, shx, shy + shh / 2 - 9, PALETTE.accent);
  segment(img, shx - 13, shy - 3, shx - 4, shy + 7, 6, PALETTE.white);
  segment(img, shx - 4, shy + 7, shx + 15, shy - 14, 6, PALETTE.white);

  sparkle(img, 46, 62, 9, rgba(150, 195, 255, 0.85));
  sparkle(img, 300, 66, 7, rgba(150, 195, 255, 0.55));
  sparkle(img, 40, 176, 6, rgba(150, 195, 255, 0.5));

  await save(img, 'agreement.png');
}

// ── 6. Review / submit (Step 8) ────────────────────────────────────────────
// A checklist on a clipboard with a verification shield. Every "line" is a
// blank rule — no baked text, so it can never contradict what the screen says.
{
  const img = canvas();
  glow(img, 168, 122, 72);

  const BOARD = rgba(52, 104, 208, 1);
  const SHEET = rgba(96, 155, 255, 1);
  const RULE = rgba(210, 232, 255, 0.9);
  const RULE_SOFT = rgba(210, 232, 255, 0.5);

  // Clipboard back plate + clip.
  roundRect(img, 66, 46, 176, 178, 14, BOARD);
  roundRect(img, 128, 34, 52, 22, 7, BOARD);
  roundRect(img, 138, 28, 32, 16, 6, rgba(150, 195, 255, 0.95));

  // Paper.
  roundRect(img, 78, 62, 152, 150, 10, SHEET);

  // Four ticked rows: a filled circle with a check, plus a ruled line.
  for (let i = 0; i < 4; i++) {
    const cy = 88 + i * 32;
    circle(img, 100, cy, 10, rgba(255, 255, 255, 0.22));
    circle(img, 100, cy, 10, rgba(30, 78, 176, 0.55));
    segment(img, 96, cy, 99, cy + 4, 3, PALETTE.white);
    segment(img, 99, cy + 4, 105, cy - 5, 3, PALETTE.white);
    roundRect(img, 118, cy - 3.5, i % 2 ? 84 : 96, 7, 3.5, i % 2 ? RULE_SOFT : RULE);
  }

  // Verification shield, overlapping the lower-right corner.
  const shx = 254;
  const shy = 174;
  const shw = 76;
  const shh = 86;
  roundRect(img, shx - shw / 2, shy - shh / 2, shw, shh * 0.62, 14, rgba(30, 78, 176, 1));
  triangle(img, shx - shw / 2, shy + shh * 0.06, shx + shw / 2, shy + shh * 0.06, shx, shy + shh / 2, rgba(30, 78, 176, 1));
  roundRect(img, shx - shw / 2 + 7, shy - shh / 2 + 7, shw - 14, shh * 0.62 - 9, 10, PALETTE.accent);
  triangle(img, shx - shw / 2 + 7, shy + shh * 0.02, shx + shw / 2 - 7, shy + shh * 0.02, shx, shy + shh / 2 - 9, PALETTE.accent);
  segment(img, shx - 14, shy - 3, shx - 4, shy + 8, 6.5, PALETTE.white);
  segment(img, shx - 4, shy + 8, shx + 16, shy - 15, 6.5, PALETTE.white);

  sparkle(img, 40, 70, 9, rgba(150, 195, 255, 0.85));
  sparkle(img, 298, 60, 7, rgba(150, 195, 255, 0.55));
  sparkle(img, 36, 186, 6, rgba(150, 195, 255, 0.5));
  sparkle(img, 318, 132, 5, rgba(150, 195, 255, 0.45));

  await save(img, 'review.png');
}

// ── 7. Live show (Seller Hub promo card) ───────────────────────────────────
// Sits on the cobalt promo surface, so this one is drawn in WHITES rather
// than blues. A rounded-square app tile holding a broadcast mark with a plus,
// echoing "schedule another show".
{
  const img = canvas();
  const W1 = rgba(255, 255, 255, 1);
  const W2 = rgba(255, 255, 255, 0.72);
  const W3 = rgba(255, 255, 255, 0.34);

  // Offset tile behind, for depth.
  roundRect(img, 96, 54, 172, 172, 40, W3);
  // Front tile.
  roundRect(img, 74, 34, 176, 176, 42, W2);
  roundRect(img, 80, 40, 164, 164, 38, W1);

  // Broadcast arc: three rising bars inside a ring gap.
  ring(img, 162, 118, 54, 11, rgba(46, 107, 255, 1));
  // Knock the lower-right quadrant out of the ring so the plus can sit there.
  roundRect(img, 168, 124, 70, 70, 0, W1);
  roundRect(img, 138, 96, 15, 46, 7.5, rgba(46, 107, 255, 1));
  roundRect(img, 160, 84, 15, 58, 7.5, rgba(46, 107, 255, 1));
  roundRect(img, 182, 104, 15, 38, 7.5, rgba(46, 107, 255, 1));

  // Plus badge.
  circle(img, 206, 162, 34, W1);
  circle(img, 206, 162, 27, rgba(46, 107, 255, 1));
  roundRect(img, 192, 157.5, 28, 9, 4.5, W1);
  roundRect(img, 201.5, 148, 9, 28, 4.5, W1);

  await save(img, 'show.png');
}

// ── 8. Canvas watermark (Show Room) ────────────────────────────────────────
// The Any&All "A" as a soft plate mark, sitting behind the empty camera
// canvas the way a brand watermark does. Deliberately low contrast: it should
// register as texture, not compete with the countdown or the controls.
{
  const img = canvas();
  // Solid in the asset; the component dials the opacity down. That keeps the
  // file inspectable instead of being an invisible near-transparent PNG.
  const PLATE = rgba(255, 255, 255, 0.35);
  const MARK = rgba(255, 255, 255, 1);

  // Rounded-square plate, centred.
  roundRect(img, 90, 30, 180, 180, 52, PLATE);

  // The mark: a chevron for the A's legs, with the notch that gives the
  // ribbon its split foot.
  const apexX = 180;
  const apexY = 72;
  const footY = 176;
  segment(img, 132, footY, apexX, apexY, 17, MARK);
  segment(img, apexX, apexY, 228, footY, 17, MARK);
  // Inner V — the negative space inside the letter.
  segment(img, 168, footY, apexX, 138, 11, MARK);
  segment(img, apexX, 138, 192, footY, 11, MARK);

  await save(img, 'canvas-watermark.png');
}
