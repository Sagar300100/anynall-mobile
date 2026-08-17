// Any&All selling taxonomy — parent groups with their subcategories.
//
// This is the list a seller picks from when scheduling a show or listing a
// product. `src/lib/categories.ts` keeps the flat top-level list that the
// buyer-facing Categories screen and its artwork use; this file is the deeper
// tree, and the two are reconciled by GROUPS' names matching those entries.
//
// The last group is named "Everything Else" rather than the competitor's
// brand name that appeared in the reference screenshots.

export interface CategoryGroup {
  name: string;
  subcategories: readonly string[];
}

export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  { name: 'Anime & Manga', subcategories: ['All Anime & Manga'] },
  {
    name: 'Antiques & Vintage Decor',
    subcategories: ['Antiques', 'Ephemera', 'Postage Stamps', 'Vintage Decor'],
  },
  {
    name: 'Arts & Handmade',
    subcategories: [
      '3D Prints',
      'Art & Prints',
      'Beads, Pens & Keychains',
      'Craft Stamps',
      'Embroidery & Needlework',
      'Glass Art',
      'Handmade Clothing',
      'Heat Transfers & Wraps',
      'Jewellery-Making Supplies',
      'Knitting & Crochet',
      'Other Arts & Handmade',
      'Quilting, Sewing & Fabrics',
      'Resin Art',
      'Scrapbook & Journaling',
      'Stickers',
      'Woodworking',
    ],
  },
  {
    name: 'Baby & Children',
    subcategories: [
      "Baby's & Children's Clothes",
      "Baby's & Children's Shoes",
      "Baby's & Children's Supplies",
    ],
  },
  {
    name: 'Bags & Accessories',
    subcategories: [
      'Luxury Bags & Accessories',
      'Modern Bags',
      'Other Accessories',
      'Sunglasses & Eyewear',
      'Vintage Bags',
    ],
  },
  {
    name: 'Beauty',
    subcategories: [
      'Bath & Body Essentials',
      'Hair Products & Wigs',
      'Makeup',
      "Men's Grooming",
      'Nails',
      'Other Beauty',
      'Perfume & Cologne',
      'Skincare',
    ],
  },
  { name: 'Books & Movies', subcategories: ['Books', 'Film Memorabilia', 'Films'] },
  {
    name: 'Coins & Money',
    subcategories: ['Ancient Coins', 'Coins & Bullion', 'Gold Nuggets', 'Paper Money & Currency'],
  },
  { name: 'Comics', subcategories: ['Modern Comics', 'Vintage Comics'] },
  {
    name: 'Electronics',
    subcategories: [
      'Cameras & Photography',
      'Everyday Electronics',
      'Home Appliances',
      'Laptops, Phones & Tablets',
      'Tools',
    ],
  },
  {
    name: 'Entertainment Cards',
    subcategories: [
      'Disney Cards',
      'Garbage Pail Kids',
      'Marvel Cards',
      'Other Entertainment Cards',
      'Star Wars Cards',
      'TV & Movie Cards',
    ],
  },
  {
    name: 'Estate Sales & Storage Units',
    subcategories: [
      'Estate Sales',
      'Garage Sales',
      'Other Estate Sales & Storage Units',
      'Storage Unit Finds',
    ],
  },
  {
    name: 'Food & Drink',
    subcategories: [
      'Baked Goods',
      'Coffee & Tea',
      'Condiments & Sauces',
      'Exotic Snacks',
      'Meat & Seafood',
      'Other Food & Drink',
      'Soda & Drinks',
      'Speciality Food',
      'Supplements',
      'Sweets & Snacks',
    ],
  },
  {
    name: 'Home & Garden',
    subcategories: [
      'Candles',
      'Holiday Decor',
      'Home Decor',
      'Kitchen & Dining',
      'Other Home & Garden',
      'Plants & Garden',
      'Tumblers & Water Bottles',
    ],
  },
  {
    name: 'Jewellery & Watches',
    subcategories: [
      'Diamonds & Gemstones',
      'Gold & Silver Jewellery',
      'Handcrafted Jewellery',
      "Men's Jewellery",
      'Other Jewellery',
      'Vintage & Antique Jewellery',
      'Watches',
      "Women's Jewellery",
    ],
  },
  {
    name: "Men's Fashion",
    subcategories: [
      "Men's Activewear",
      "Men's Big & Tall Fashion",
      "Men's Formalwear",
      "Men's Modern",
      "Men's Vintage Clothing",
      "Other Men's Fashion",
      'Sports Apparel',
      'Streetwear',
    ],
  },
  {
    name: 'Music',
    subcategories: [
      'CDs & Cassettes',
      'Instruments & Accessories',
      'Music Memorabilia',
      'Other Music',
      'Vinyl Records',
    ],
  },
  {
    name: 'Outdoors',
    subcategories: ['Camping & Hiking Gear', 'Hunting & Fishing', 'Knives & EDC', 'Tactical Gear'],
  },
  { name: 'Pets', subcategories: ['Dog & Cat', 'Horse Tack', 'Other Pets', 'Pet Fish'] },
  {
    name: 'Rocks & Crystals',
    subcategories: ['Crystals & Gems', 'Fossils', 'Mineral Specimens', 'Other Rocks'],
  },
  { name: 'Sneakers & Shoes', subcategories: ['Sneakers'] },
  {
    name: 'Sporting Goods',
    subcategories: [
      'Baseball & Softball',
      'Cycling & Running',
      'Disc Golf',
      'Golf',
      'Multi-Purpose Sporting Goods',
      'Skate & Surf',
      'Winter Sports',
    ],
  },
  {
    name: 'Sports Cards',
    subcategories: [
      'AFL Cards',
      'American Football Cards',
      'Baseball Cards',
      'Basketball Cards',
      'F1 Cards',
      'Football Cards',
      'Hockey Cards',
      'NASCAR Cards',
      'Other Sports Cards',
      'Rugby Cards',
      'UFC Cards',
      'Wrestling Cards',
    ],
  },
  {
    name: 'Sports Memorabilia',
    subcategories: [
      'American Football Memorabilia',
      'Baseball Memorabilia',
      'Basketball Memorabilia',
      'Football Memorabilia',
      'Other Sports Memorabilia',
    ],
  },
  {
    name: 'Toys & Hobbies',
    subcategories: [
      'Action Figures',
      'Baby & Kids Toys',
      'Bearbrick',
      'Board Games & Puzzles',
      'Diecast',
      'Disney',
      'Dolls',
      'Fast Food & Cereal Toys',
      'FigPin',
      'Funko',
      'Kawaii',
      'Labubu & Blind Boxes',
      'LEGO',
      'Littlest Pet Shop',
      'Loungefly',
      'Models & Kits',
      'Other Designer Toys',
      'Other Toys',
      'Plush',
      'RC Vehicles & Toys',
      'RPG & Miniatures',
      'Slime & Squishy Toys',
      'Slot Cars',
      'Sonny Angels & Smiskis',
      'Star Wars Toys',
      'Vintage Toys',
    ],
  },
  {
    name: 'Trading Card Games',
    subcategories: [
      'Digimon Cards',
      'Dragon Ball Cards',
      'Flesh & Blood',
      'Gundam Cards',
      'Lorcana',
      'Magic: The Gathering',
      'MetaZoo',
      'Naruto Cards',
      'One Piece Cards',
      'Other TCG',
      'Pokémon Cards',
      'Riftbound',
      'Sorcery: Contested Realm',
      'Union Arena',
      'UniVersus',
      'VeeFriends',
      'Weiß Schwarz',
      'Yu-Gi-Oh! Cards',
    ],
  },
  {
    name: 'Video Games',
    subcategories: ['Consoles & Accessories', 'Guides, Manuals & Cases', 'Modern Games', 'Retro Games'],
  },
  {
    name: 'Wholesale & Deals',
    subcategories: ['Case Packs & Bundles', 'Deal Hunting', 'Pallets'],
  },
  {
    name: "Women's Fashion",
    subcategories: [
      "Other Women's Fashion",
      "Women's Activewear",
      "Women's Boutiques",
      "Women's Contemporary",
      "Women's Dresses",
      "Women's Plus Size",
      "Women's Shoes",
      "Women's Swimwear",
      "Women's True Vintage",
      'Y2K',
    ],
  },
  {
    name: 'Everything Else',
    subcategories: ['Community', 'Religious & Spiritual', 'Other'],
  },
];

/** How a show primarily sells. Stored on the show doc as
 *  `primarySellingFormat`; `auction` and `buy-it-now` line up with the
 *  product kinds ordersRouter already accepts. */
export type SellingFormat = 'auction' | 'buy-it-now' | 'surprise-sets';

export const SELLING_FORMATS: {
  value: SellingFormat;
  label: string;
  body: string;
}[] = [
  { value: 'auction', label: 'Auction', body: 'Products sold to the highest bidder.' },
  {
    value: 'buy-it-now',
    label: 'Buy It Now',
    body: 'Products sold at a fixed price. Includes flash sales.',
  },
  {
    value: 'surprise-sets',
    label: 'Surprise Sets',
    body: 'Bundles sold without the buyer knowing exactly what they’ll receive.',
  },
];

/** Case-insensitive match across group names and subcategories. */
export function filterGroups(qRaw: string): CategoryGroup[] {
  const q = qRaw.trim().toLowerCase();
  if (!q) return [...CATEGORY_GROUPS];
  return CATEGORY_GROUPS.map((g) => {
    // A group-name hit keeps every child; otherwise keep matching children.
    if (g.name.toLowerCase().includes(q)) return g;
    const subs = g.subcategories.filter((s) => s.toLowerCase().includes(q));
    return subs.length ? { name: g.name, subcategories: subs } : null;
  }).filter((g): g is CategoryGroup => g !== null);
}
