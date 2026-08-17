// Generates the auth background image: a deep-space nebula with real cloud
// turbulence and a dense starfield. Run: node scripts/generate-cosmic-bg.mjs
//
// SVG gradients can't produce photographic cloud structure, so the texture is
// synthesised here with fractal Brownian motion (layered value noise) and
// baked to a PNG the app ships as an asset.
import Jimp from 'jimp-compact';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'images', 'auth-cosmos.png');

const W = 1080;
const H = 2400;
const SEED = 20260803; // fixed so the sky is reproducible

// ── deterministic PRNG + value noise ────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

// Hash-based lattice noise (stable, no table allocation per call).
function hash2(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/** Fractal Brownian motion — the layered octaves are what read as "cloud". */
function fbm(x, y, octaves = 6) {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    value += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.07; // non-integer avoids visible repetition
  }
  return value / norm;
}

// ── palette ─────────────────────────────────────────────────────────
const BASE = [4, 7, 20];
const VIOLET = [124, 66, 196];
const MAGENTA = [186, 84, 146];
const TEAL = [42, 150, 178];
const BLUE = [46, 92, 200];
const AMBER = [232, 132, 74]; // warm dust either side of the credential form
const CYAN = [120, 200, 255]; // halo behind the brand mark

// Where the UI lands vertically, as a fraction of image height. The sky's
// features are placed against these so the glow reads as one continuous scene
// showing through the glass — not per-component effects bolted on top.
const UI = {
  logo: 0.14,
  form: 0.4, // measured against the rendered screen, not guessed
  signup: 0.67,
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function addTint(px, colour, amount) {
  px[0] = Math.min(255, px[0] + colour[0] * amount);
  px[1] = Math.min(255, px[1] + colour[1] * amount);
  px[2] = Math.min(255, px[2] + colour[2] * amount);
}

async function main() {
  const img = new Jimp(W, H, 0x000000ff);
  const b = img.bitmap.data;

  // Nebula field
  for (let y = 0; y < H; y += 1) {
    const v = y / H;
    for (let x = 0; x < W; x += 1) {
      const u = x / W;
      const i = (y * W + x) * 4;

      // Vertical base wash, darkest at the bottom.
      const px = [
        lerp(BASE[0] + 8, BASE[0], v),
        lerp(BASE[1] + 10, BASE[1], v),
        lerp(BASE[2] + 22, BASE[2], v),
      ];

      // Three cloud layers at different scales/offsets.
      const n1 = fbm(u * 3.1, v * 5.4 + 11.3, 6);
      const n2 = fbm(u * 5.6 + 31.7, v * 8.2 + 4.1, 5);
      const n3 = fbm(u * 2.2 + 77.5, v * 3.6 + 52.9, 6);

      // Overall tint strength. The sky must stay near-black so the UI reads
      // cleanly — colour is an accent, not a wash. (An earlier pass at ~1.0
      // produced a bright purple haze that muddied the whole screen.)
      const T = 0.34;

      // Violet mass through the upper-left third.
      const violetMask =
        clamp01(1.25 - Math.hypot(u - 0.22, (v - 0.16) * 1.5) * 2.2) * clamp01(n1 * 1.5 - 0.35);
      addTint(px, VIOLET, violetMask * 0.95 * T);

      // Magenta veil down the right edge.
      const magentaMask =
        clamp01(1.15 - Math.hypot(u - 1.02, (v - 0.42) * 1.1) * 2.0) * clamp01(n2 * 1.5 - 0.4);
      addTint(px, MAGENTA, magentaMask * 0.75 * T);

      // Teal drift across the middle.
      const tealMask = clamp01(1.0 - Math.abs(v - 0.52) * 3.2) * clamp01(n3 * 1.4 - 0.5);
      addTint(px, TEAL, tealMask * 0.6 * T);

      // Blue depth low-right.
      const blueMask =
        clamp01(1.2 - Math.hypot(u - 0.82, (v - 0.88) * 1.2) * 2.1) * clamp01(n1 * 1.3 - 0.4);
      addTint(px, BLUE, blueMask * 0.7 * T);

      // ── features placed against the UI ────────────────────────────
      // Cyan halo behind the brand mark.
      const haloMask = clamp01(1 - Math.hypot((u - 0.5) * 1.4, (v - UI.logo) * 3.4) * 2.4);
      addTint(px, CYAN, haloMask * haloMask * 0.42 * T);

      // Warm amber dust either side of the credential form — the reference's
      // only warm accent, kept to the outer edges so it never sits under text.
      // Deliberately exempt from the global T so the warm accent actually
      // reads — at T it washed out to nothing against the dark sky.
      const amberL =
        clamp01(1 - Math.hypot((u - 0.0) * 2.2, (v - UI.form) * 4.0)) * clamp01(n2 * 1.6 - 0.22);
      const amberR =
        clamp01(1 - Math.hypot((u - 1.0) * 2.1, (v - (UI.form - 0.03)) * 3.8)) *
        clamp01(n3 * 1.6 - 0.24);
      addTint(px, AMBER, (amberL + amberR) * 0.85);

      // Magenta / violet swirl behind the sign-up panel.
      const swirlMask =
        clamp01(1 - Math.hypot((u - 0.5) * 1.05, (v - UI.signup) * 3.0)) *
        clamp01(n1 * 1.5 - 0.3);
      addTint(px, MAGENTA, swirlMask * 0.85 * T);
      addTint(px, VIOLET, swirlMask * 0.5 * T);

      // ── light structure in the sky ────────────────────────────────
      // Work in width-units so circles stay circular on a 1080×2400 frame.
      const yy = v * (H / W);

      // Broad curved limb sweeping the upper-left, exactly the arc in the
      // reference: a soft-edged band, not a stroke. Two passes — a wide, faint
      // halo and a tighter brighter core.
      const arcD = Math.abs(Math.hypot(u + 0.2, yy - 0.2) - 0.55);
      const arcCore = Math.exp(-((arcD / 0.012) ** 2));
      const arcHalo = Math.exp(-((arcD / 0.055) ** 2));
      // Fades out as it runs down the frame so it never crosses the form.
      const arcFade = clamp01(1.15 - v * 1.6);
      addTint(px, CYAN, (arcCore * 0.5 + arcHalo * 0.16) * arcFade);

      // A second, wider limb further out — depth behind the first.
      const arc2D = Math.abs(Math.hypot(u + 0.34, yy - 0.1) - 0.82);
      const arc2 = Math.exp(-((arc2D / 0.03) ** 2));
      addTint(px, CYAN, arc2 * 0.16 * clamp01(1.1 - v * 1.5));

      // Mirrored arc on the right shoulder, fainter.
      const arc3D = Math.abs(Math.hypot(u - 1.24, yy - 0.5) - 0.62);
      const arc3 = Math.exp(-((arc3D / 0.026) ** 2));
      addTint(px, VIOLET, arc3 * 0.3 * clamp01(1.2 - Math.abs(v - 0.34) * 2.2));

      // Diffuse wisps: elongated, noise-broken bands drifting through the
      // mid-field, so the sky has structure rather than smooth gradients.
      const wisp1 = Math.exp(-(((u * 0.9 + v * 0.5 - 0.95) / 0.05) ** 2)) * clamp01(n2 * 1.7 - 0.35);
      addTint(px, TEAL, wisp1 * 0.55);
      const wisp2 = Math.exp(-(((u * -0.7 + v * 0.9 - 0.1) / 0.06) ** 2)) * clamp01(n3 * 1.7 - 0.4);
      addTint(px, MAGENTA, wisp2 * 0.5);

      // Vignette: keep the centre column readable and the frame dark.
      const vig = clamp01(1 - Math.hypot((u - 0.5) * 1.25, (v - 0.42) * 0.95) * 1.15);
      const k = 0.3 + 0.7 * vig;

      b[i] = Math.min(255, px[0] * k);
      b[i + 1] = Math.min(255, px[1] * k);
      b[i + 2] = Math.min(255, px[2] * k);
      b[i + 3] = 255;
    }
  }

  // Starfield — most tiny, a few bright with a soft halo.
  const STAR_COUNT = 900;
  for (let s = 0; s < STAR_COUNT; s += 1) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H);
    const roll = rand();
    const bright = roll > 0.985 ? 1 : roll > 0.9 ? 0.72 : roll > 0.65 ? 0.45 : 0.26;
    const radius = roll > 0.985 ? 2.2 : roll > 0.9 ? 1.5 : 1;

    // Fade stars that fall behind the form column so text stays clean.
    const u = x / W;
    const v = y / H;
    const centreFade = Math.hypot((u - 0.5) * 1.5, (v - 0.5) * 0.8) < 0.42 ? 0.45 : 1;

    const r = Math.ceil(radius * 2.2);
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const d = Math.hypot(dx, dy);
        const fall = Math.exp(-(d * d) / (2 * radius * radius));
        if (fall < 0.01) continue;
        const i = (py * W + px) * 4;
        const add = 255 * bright * fall * centreFade;
        b[i] = Math.min(255, b[i] + add);
        b[i + 1] = Math.min(255, b[i + 1] + add);
        b[i + 2] = Math.min(255, b[i + 2] + add * 1.05);
      }
    }
  }

  await img.writeAsync(OUT);
  console.log(`wrote ${OUT} (${W}x${H})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
