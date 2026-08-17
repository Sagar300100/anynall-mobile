// Central category-artwork mapping — the ONLY place category visuals live.
//
// Assets are individual crops from the approved artwork collage
// (assets/source/category-collage.png), generated deterministically by
// scripts/extract-category-art.mjs. Slugs derive from the real category
// names in lib/categories.ts. A real category without approved artwork gets
// the controlled fallback (dark tile + one Ionicons glyph) — never a stock
// photo.
import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ImageSourcePropType } from 'react-native';

/** Deterministic slug from a real category display name. */
export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ARTWORK: Record<string, ImageSourcePropType> = {
  'trading-card-games': require('../../assets/categories/trading-card-games.png'),
  'sports-cards': require('../../assets/categories/sports-cards.png'),
  'coins-money': require('../../assets/categories/coins-money.png'),
  'sneakers-streetwear': require('../../assets/categories/sneakers-streetwear.png'),
  'bags-accessories': require('../../assets/categories/bags-accessories.png'),
  'mens-fashion': require('../../assets/categories/mens-fashion.png'),
  'womens-fashion': require('../../assets/categories/womens-fashion.png'),
  electronics: require('../../assets/categories/electronics.png'),
  'video-games': require('../../assets/categories/video-games.png'),
  collectibles: require('../../assets/categories/collectibles.png'),
  comics: require('../../assets/categories/comics.png'),
  'anime-manga': require('../../assets/categories/anime-manga.png'),
  'books-movies': require('../../assets/categories/books-movies.png'),
  'toys-hobbies': require('../../assets/categories/toys-hobbies.png'),
  'arts-handmade': require('../../assets/categories/arts-handmade.png'),
  beauty: require('../../assets/categories/beauty.png'),
  jewelry: require('../../assets/categories/jewelry.png'),
  'home-garden': require('../../assets/categories/home-garden.png'),
  'baby-kids': require('../../assets/categories/baby-kids.png'),
  pets: require('../../assets/categories/pets.png'),
  music: require('../../assets/categories/music.png'),
  'sports-memorabilia': require('../../assets/categories/sports-memorabilia.png'),
  'outdoor-gear': require('../../assets/categories/outdoor-gear.png'),
  'vintage-antiques': require('../../assets/categories/vintage-antiques.png'),
  'any-all-exclusives': require('../../assets/categories/any-all-exclusives.png'),
  // Curated mappings — approved collage tiles assigned to real categories the
  // collage has no direct tile for (see scripts/extract-category-art.mjs):
  'home-decor': require('../../assets/categories/home-decor.png'),
  'food-drink': require('../../assets/categories/food-drink.png'),
  'sporting-goods': require('../../assets/categories/sporting-goods.png'),
  art: require('../../assets/categories/art.png'),
  'knives-hunting': require('../../assets/categories/knives-hunting.png'),
  fashion: require('../../assets/categories/fashion.png'),
  // Approved-art reuse where the closest tile already serves a sibling
  // category (non-adjacent in every ordering we show):
  'antiques-vintage-decor': require('../../assets/categories/vintage-antiques.png'),
  sports: require('../../assets/categories/sports-memorabilia.png'),
};

/** Approved artwork for a real category, or null → use the icon fallback. */
export function categoryArtwork(name: string): ImageSourcePropType | null {
  return ARTWORK[categorySlug(name)] ?? null;
}

/** True when a category has approved artwork (used to curate the rail). */
export function hasArtwork(name: string): boolean {
  return categorySlug(name) in ARTWORK;
}

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Controlled fallback glyphs for real categories without approved artwork. */
const FALLBACK_ICONS: Record<string, IoniconName> = {
  'Rocks & Crystals': 'diamond-outline',
};

export function categoryIcon(name: string): IoniconName {
  return FALLBACK_ICONS[name] ?? 'pricetags-outline';
}
