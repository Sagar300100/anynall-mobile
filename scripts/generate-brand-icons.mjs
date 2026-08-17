// Generates the app icon set from the official Any&All "A" ribbon mark
// (public/assets/brand/any_all_A_mark_transparent.png in the web repo).
// Run: node scripts/generate-brand-icons.mjs
// Uses jimp-compact (already in node_modules via @expo/image-utils).
import Jimp from 'jimp-compact';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MARK = path.resolve(ROOT, '..', 'public', 'assets', 'brand', 'any_all_A_mark_transparent.png');
const OUT = path.join(ROOT, 'assets', 'images');

const NAVY = 0x050a18ff; // brand --bg-base

async function markAt(size, scale) {
  const mark = await Jimp.read(MARK);
  mark.contain(Math.round(size * scale), Math.round(size * scale));
  return mark;
}

function canvas(size, color) {
  return new Jimp(size, size, color);
}

function centerComposite(base, layer) {
  const x = Math.round((base.getWidth() - layer.getWidth()) / 2);
  const y = Math.round((base.getHeight() - layer.getHeight()) / 2);
  return base.composite(layer, x, y);
}

async function main() {
  const S = 1024;

  // 1. Main app icon: navy field, mark at 72%.
  const icon = centerComposite(canvas(S, NAVY), await markAt(S, 0.72));
  await icon.writeAsync(path.join(OUT, 'icon.png'));

  // 2. Android adaptive foreground: transparent, mark inside the ~66% safe
  //    zone so launchers can mask to circle/squircle without clipping.
  const fg = centerComposite(canvas(S, 0x00000000), await markAt(S, 0.52));
  await fg.writeAsync(path.join(OUT, 'android-icon-foreground.png'));

  // 3. Android adaptive background: solid navy.
  await canvas(S, NAVY).writeAsync(path.join(OUT, 'android-icon-background.png'));

  // 4. Android monochrome (themed icons): white silhouette from the mark's alpha.
  const mono = centerComposite(canvas(S, 0x00000000), await markAt(S, 0.52));
  mono.scan(0, 0, mono.getWidth(), mono.getHeight(), function (x, y, idx) {
    if (this.bitmap.data[idx + 3] > 0) {
      this.bitmap.data[idx] = 255;
      this.bitmap.data[idx + 1] = 255;
      this.bitmap.data[idx + 2] = 255;
    }
  });
  await mono.writeAsync(path.join(OUT, 'android-icon-monochrome.png'));

  // 5. Splash mark: the raw transparent mark, high-res (rendered small by
  //    expo-splash-screen; navy splash bg comes from app.json).
  const splash = await markAt(512, 1);
  await splash.writeAsync(path.join(OUT, 'splash-icon.png'));

  // 6. Favicon (expo web preview).
  const fav = centerComposite(canvas(196, NAVY), await markAt(196, 0.78));
  await fav.writeAsync(path.join(OUT, 'favicon.png'));

  // 7. In-app brand mark (top bars, sign-in) — trimmed transparent mark.
  const inApp = await markAt(512, 1);
  await inApp.writeAsync(path.join(OUT, 'brand-mark.png'));

  console.log('done: icon, adaptive fg/bg/mono, splash, favicon, brand-mark');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
