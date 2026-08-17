// Prepares the launch-splash assets from the supplied source files.
// Run: node scripts/prepare-splash-assets.mjs
//
// The supplied logo is artwork on a SOLID BLACK field, not a transparent PNG.
// Composited as-is over the gradient background it would show a black square,
// so alpha is derived from luminance (RGB is untouched — the mark itself is
// never recoloured or redrawn). Glow edges become correctly semi-transparent.
import Jimp from 'jimp-compact';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'assets', 'images');
const HOME = process.env.USERPROFILE || process.env.HOME || '';

const SRC_BG = path.join(
  HOME,
  'Downloads',
  'u2489326535_minimal_premium_mobile_app_splash_background_full_a5fd8755-3b21-44a8-b701-81428c011d1c_1.png'
);
const SRC_LOGO = path.join(HOME, 'Downloads', 'C7BB580E-9A9D-4937-8FEC-465A0FB15622.PNG');

async function main() {
  // 1. Background — copied verbatim, no recolouring or effects.
  const bg = await Jimp.read(SRC_BG);
  await bg.writeAsync(path.join(OUT, 'splash-bg.png'));
  console.log(`splash-bg.png  ${bg.getWidth()}x${bg.getHeight()}`);

  // 2. Logo — RGB is left exactly as supplied; only the flat black field is
  //    keyed out. Alpha ramps over a narrow band just above black so glow
  //    edges feather instead of showing a hard cut-out.
  //
  //    (Keying on luminance instead would drop the ribbon's own dark blues and
  //    wash the artwork out — it must key on "how far from black", not
  //    "how bright".)
  const BLACK = 10; // at or below → fully transparent
  const SOLID = 46; // at or above → fully opaque
  const logo = await Jimp.read(SRC_LOGO);
  logo.scan(0, 0, logo.getWidth(), logo.getHeight(), function (x, y, idx) {
    const m = Math.max(
      this.bitmap.data[idx],
      this.bitmap.data[idx + 1],
      this.bitmap.data[idx + 2]
    );
    const a = m <= BLACK ? 0 : m >= SOLID ? 255 : Math.round(((m - BLACK) / (SOLID - BLACK)) * 255);
    this.bitmap.data[idx + 3] = a;
  });
  logo.autocrop({ tolerance: 0.002, cropOnlyFrames: false });
  await logo.writeAsync(path.join(OUT, 'splash-logo.png'));
  console.log(`splash-logo.png ${logo.getWidth()}x${logo.getHeight()} (alpha keyed, trimmed)`);

  // 3. Single composited plate used by BOTH splash stages.
  //
  //    The native stage can't render a React layout, so the only way the two
  //    stages can look identical is for both to draw the *same image* with the
  //    same `cover` maths. Baking the logo in guarantees that — no colour jump
  //    from a flat backgroundColor, no logo jump from mismatched sizing.
  //
  //    Logo width is chosen so that after cover-scaling on a typical 9:20
  //    phone it lands at ~42% of screen width.
  const plate = await Jimp.read(SRC_BG);
  const PW = plate.getWidth();
  const PH = plate.getHeight();
  const mark = logo.clone();
  const markW = Math.round(PW * 0.337); // → ≈42% of screen after cover scale
  mark.resize(markW, Jimp.AUTO);
  plate.composite(
    mark,
    Math.round((PW - mark.getWidth()) / 2),
    Math.round((PH - mark.getHeight()) / 2)
  );
  await plate.writeAsync(path.join(OUT, 'splash-full.png'));
  console.log(`splash-full.png ${PW}x${PH} (logo composited, mark ${mark.getWidth()}px)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
