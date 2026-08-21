// Seller Hub data — real seller-scoped reads only.
//
// Everything here maps to an endpoint that returns the seller's actual
// records. There is deliberately no revenue/payout client: analyticsRouter's
// sales figures are hardcoded zeros until the payments backend lands (see its
// own comment), so surfacing them as measured numbers would be a lie. The hub
// shows counts it can genuinely derive and orders that genuinely exist.
import { j } from './api';

export interface AuctionConfig {
  /** Paise. */
  startPrice: number;
  /** Paise. */
  bidStep: number;
  durationSeconds: number;
  /** Anti-sniping off: the clock is hard, last bid in wins. */
  suddenDeath: boolean;
}

/** Parcel size in centimetres. Couriers bill on the greater of actual and
 *  volumetric weight ((L×B×H)/5000), so these are real billing inputs. */
export interface ParcelDimensions {
  length: number;
  breadth: number;
  height: number;
}

export interface SellerProduct {
  id: string;
  title: string;
  /** Paise. */
  price: number;
  stock: number;
  sold: number;
  kind: string;
  thumbnail_url: string | null;
  images: string[];
  status: string;
  description: string;
  category: string;
  condition: string;
  sku: string;
  hazmat: string;
  /** Paise the buyer pays for delivery; 0 = the seller absorbs it. */
  shippingFee: number;
  weightGrams: number | null;
  dimensionsCm: ParcelDimensions | null;
  showId: string | null;
  /** Show-scoped listing: never browsable in the marketplace. */
  temporary: boolean;
  /** Buy Now spotlight — the server keeps at most one per show. */
  pinned: boolean;
  auctionConfig: AuctionConfig | null;
  /** Seller-private margin data; absent unless they set one. */
  costPaise: number | null;
  createdAtMs: number;
  /** Gap 8 (additive) — present once the backend returns them. Flash sale on
   *  the product doc; endsAt may be ISO or a Firestore Timestamp shape. */
  flashSale?: { pricePaise: number; endsAt: unknown } | null;
  /** Set by the server once the giveaway has been drawn. */
  giveawayWinner?: { uid: string; name: string; drawnAt?: unknown } | null;
}

export interface SellingOrder {
  id: string;
  productId: string | null;
  showId: string | null;
  productTitle: string;
  quantity: number;
  /** Paise. */
  amount: number;
  currency: string;
  status: string;
  purchaseType: string;
  buyerName: string | null;
  destination: { city: string | null; stateCode: string | null; pincode: string | null } | null;
  /** Paise breakdown when present: { itemSubtotal, shippingFee, totalAmount }. */
  pricing: { itemSubtotal?: number; shippingFee?: number; totalAmount?: number } | null;
  /** Shiprocket booking state — see lib/shipping.ts Shipment. */
  shipment: import('./shipping').Shipment | null;
  createdAt: string | null;
  createdAtMs: number;
  // ── Buyer protection (spec Gap 2) — additive, absent until the backend
  //    wave stamps them on the order docs. See lib/protection.ts.
  /** ISO — Shiprocket webhook or the seller's own "mark delivered". */
  deliveredAt?: string | null;
  /** ISO — deliveredAt + 24h. */
  complaintWindowEndsAt?: string | null;
  /** `{ status: in_window|disputed|released|refunded_pending }`. */
  protection?: import('./protection').OrderProtection | null;
  /** The buyer's filed complaint — category/note/videoPath/filedAt. */
  dispute?: import('./protection').OrderDispute | null;
}

/** `all=1` returns every row; the default collapses duplicate title+price
 *  pairs, which is wrong for a hub that reports how many listings exist. */
export function getMyProducts() {
  return j<{ products: SellerProduct[] }>('/api/products/mine?all=1', undefined, true);
}

export function getSellingOrders() {
  return j<{ orders: SellingOrder[] }>('/api/orders/selling', undefined, true);
}

export interface AnalyticsDashboard {
  range: string;
  stats: { label: string; value: string }[];
  revenueBars: { label: string; value: number }[];
  traffic: { label: string; value: number }[];
  topProducts: { name: string; units: number; revenue: string }[];
  sessions: unknown[];
}

/** The full dashboard (GET /api/analytics/dashboard). REAL data only — the
 *  backend returns genuine zeros for sales until the payments ledger feeds
 *  it, and the screen renders honest empty states, never fake charts. */
export function fetchAnalyticsDashboard(range = '7d') {
  return j<AnalyticsDashboard>(
    `/api/analytics/dashboard?range=${encodeURIComponent(range)}`,
    undefined,
    true
  );
}

/** Only `Shows created` is a real measurement today — the sales figures in
 *  this response are placeholders the backend admits to. We read the show
 *  count and ignore the rest. */
export function getSellerShowCount() {
  return j<{ stats: { label: string; value: string }[] }>(
    '/api/analytics/dashboard?range=7d',
    undefined,
    true
  ).then((r) => {
    const row = r.stats?.find((s) => /shows created/i.test(s.label));
    const n = Number(row?.value);
    return Number.isFinite(n) ? n : null;
  });
}

/** Limits enforced by ordersRouter — mirrored so the form can validate
 *  before spending a request, never instead of the server checking. */
export const PRICE_MIN_PAISE = 100; // ₹1
export const PRICE_MAX_PAISE = 500_000 * 100; // ₹5,00,000
export const STOCK_MAX = 10_000;
export const TITLE_MAX = 140;
export const SHIPPING_MAX_PAISE = 5_000 * 100; // ₹5,000 — guards a typo
export const WEIGHT_MAX_GRAMS = 30_000; // above 30kg is freight, not courier
export const DIMENSION_MAX_CM = 150;

export type ProductKind = 'buy-it-now' | 'auction' | 'giveaway';

export const PRODUCT_KINDS: { value: ProductKind; label: string; hint: string }[] = [
  { value: 'buy-it-now', label: 'Buy Now', hint: 'Sells at a fixed price' },
  { value: 'auction', label: 'Auction', hint: 'Buyers bid during a live show' },
  { value: 'giveaway', label: 'Giveaway', hint: 'Free — no payment taken' },
];

/** Listing lifecycle, exactly the server's set: active = listed and buyable,
 *  draft = saved but never sellable, inactive = retired. */
export type ProductStatus = 'active' | 'draft' | 'inactive';

export const PRODUCT_STATUSES: { value: ProductStatus; label: string; hint: string }[] = [
  { value: 'active', label: 'Active', hint: 'Listed and buyable' },
  { value: 'draft', label: 'Draft', hint: 'Saved — buyers never see it' },
  { value: 'inactive', label: 'Inactive', hint: 'Retired from sale' },
];

/** Listing condition. `new`/`pre-owned` cover plain goods; the graded values
 *  are what a collectibles seller reaches for. Server-side set. */
export const CONDITIONS: { value: string; label: string }[] = [
  { value: 'mint', label: 'Mint' },
  { value: 'near-mint', label: 'Near Mint' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'new', label: 'New' },
  { value: 'pre-owned', label: 'Pre-owned' },
];

/** Courier-restricted goods. `none` is the normal answer; the rest tell
 *  Shiprocket the parcel can't fly. Server-side set. */
export const HAZMAT_KINDS: { value: string; label: string }[] = [
  { value: 'lithium-battery', label: 'Lithium battery' },
  { value: 'fragrance', label: 'Aerosol or fragrance' },
  { value: 'other-regulated', label: 'Other regulated item' },
];

/** Auction lengths the server accepts (15s–900s). */
export const TIME_LIMITS: { seconds: number; label: string }[] = [
  { seconds: 15, label: '15s' },
  { seconds: 30, label: '30s' },
  { seconds: 45, label: '45s' },
  { seconds: 60, label: '1m' },
  { seconds: 120, label: '2m' },
  { seconds: 300, label: '5m' },
  { seconds: 600, label: '10m' },
  { seconds: 900, label: '15m' },
];

export const IMAGES_MAX = 12;
export const DESCRIPTION_MAX = 1000;

/** `showId` is optional. Catalogue items are created standalone and attached
 *  to shows later; a `temporary` listing is the opposite — it belongs to one
 *  show, never reaches the marketplace, and the server rejects it without a
 *  showId to belong to. */
export function createProduct(p: {
  title: string;
  /** Paise. */
  price: number;
  stock: number;
  kind: ProductKind;
  thumbnail_url?: string | null;
  images?: string[];
  description?: string;
  condition?: string;
  category?: string;
  sku?: string;
  hazmat?: string;
  showId?: string;
  temporary?: boolean;
  /** Seller-private; stored outside the world-readable product doc. */
  costPaise?: number | null;
  /** Auction prefill, incl. the Sudden Death choice. */
  auction?: {
    startPrice: number;
    bidStep?: number;
    durationSeconds: number;
    suddenDeath: boolean;
  } | null;
  /** Paise. 0 means the seller absorbs shipping. */
  shippingFee?: number;
  weightGrams?: number;
  dimensionsCm?: ParcelDimensions | null;
}) {
  return j<{ id: string }>(
    '/api/products',
    {
      method: 'POST',
      body: JSON.stringify({
        ...p,
        // Provenance: buyers must only ever see real photos of the actual
        // item, so an uploaded photo is the only source we ever claim.
        ...(p.thumbnail_url ? { imageSource: 'uploaded' } : {}),
      }),
    },
    true
  );
}

/** Fields PATCH /api/products/:id accepts — the same parsers as create, so
 *  everything is bounded server-side. The server refuses edits that would
 *  oversell (stock below sold+reserved → 409 STOCK_BELOW_COMMITTED) and
 *  refuses to draft/deactivate a product still attached to a show
 *  (409 PRODUCT_IN_SHOW); surface those messages, never swallow them. */
export interface ProductPatch {
  title?: string;
  /** Paise. */
  price?: number;
  stock?: number;
  kind?: ProductKind;
  thumbnail_url?: string;
  description?: string;
  category?: string;
  condition?: string;
  sku?: string;
  hazmat?: string;
  status?: ProductStatus;
  /** Paise. */
  shippingFee?: number;
  weightGrams?: number;
  dimensionsCm?: ParcelDimensions;
}

/** PATCH /api/products/:id — edit the seller's own listing. */
export function updateProduct(id: string, patch: ProductPatch) {
  return j<{ id: string }>(
    `/api/products/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
    true
  );
}

/** POST /api/products/:id/pin — Buy Now spotlight. The server unpins any
 *  sibling in the same show first, so pinning always replaces. */
export function pinProduct(id: string) {
  return j<{ ok: boolean; productId: string; pinned: boolean }>(
    `/api/products/${encodeURIComponent(id)}/pin`,
    { method: 'POST' },
    true
  );
}

/** POST /api/products/:id/unpin — clear the spotlight. */
export function unpinProduct(id: string) {
  return j<{ ok: boolean; productId: string; pinned: boolean }>(
    `/api/products/${encodeURIComponent(id)}/unpin`,
    { method: 'POST' },
    true
  );
}

/** POST /api/products/:id/attach-show — make an existing catalogue product
 *  purchasable in a show. Only ACTIVE products attach (the server 409s
 *  PRODUCT_NOT_ACTIVE otherwise) and attaching always clears any stale pin.
 *  Optional overrides ride along and are re-validated server-side. */
export function attachProductToShow(
  productId: string,
  body: {
    showId: string;
    kind?: ProductKind;
    /** Paise. */
    price?: number;
    stock?: number;
    thumbnail_url?: string;
    /** Paise. */
    shippingFee?: number;
    weightGrams?: number;
    dimensionsCm?: ParcelDimensions | null;
    auction?: {
      startPrice: number;
      bidStep?: number;
      durationSeconds: number;
      suddenDeath?: boolean;
    } | null;
  }
) {
  return j<{ ok: boolean; productId: string; showId: string }>(
    `/api/products/${encodeURIComponent(productId)}/attach-show`,
    { method: 'POST', body: JSON.stringify(body) },
    true
  );
}

/** POST /api/products/:id/detach-show — back to unattached inventory.
 *  Never deletes the product. */
export function detachProductFromShow(productId: string) {
  return j<{ ok: boolean; productId: string }>(
    `/api/products/${encodeURIComponent(productId)}/detach-show`,
    { method: 'POST' },
    true
  );
}

// =====================================================
//        GAP 8 — GIVEAWAY DRAW, OFFERS, FLASH SALES
// =====================================================

/** POST /api/shows/:id/giveaways/:productId/draw (seller-only) — the server
 *  picks one entry at random, writes product.giveawayWinner, announces the
 *  winner in chat (canonical chat doc) and creates the zero-amount
 *  type:'giveaway' order so shipping shows up in both order lists. */
export function drawGiveawayWinner(showId: string, productId: string) {
  return j<{ ok: boolean; winner: { uid: string; name: string }; orderId?: string }>(
    `/api/shows/${encodeURIComponent(showId)}/giveaways/${encodeURIComponent(productId)}/draw`,
    { method: 'POST', body: JSON.stringify({}) },
    true
  );
}

/** One row of GET /api/offers/mine — the offers/{autoId} doc shape from the
 *  spec plus the display fields the listing panel needs. Everything beyond
 *  the spec's core fields is optional so a leaner backend response still
 *  renders. */
export interface OfferRecord {
  id: string;
  productId: string;
  showId?: string | null;
  productTitle?: string;
  buyerName?: string | null;
  /** Paise — what the buyer offered. */
  amountPaise: number;
  /** Paise — the product's list price, for the "vs list" comparison. */
  listPricePaise?: number;
  /** open | accepted | declined | expired */
  status: string;
  createdAt?: string | null;
  /** Creation + 24h. */
  expiresAt?: string | null;
}

/** GET /api/offers/mine?role=seller&status=open — the seller's open offers. */
export function getOpenOffers(role: 'seller' | 'buyer' = 'seller', status = 'open') {
  return j<{ offers: OfferRecord[] }>(
    `/api/offers/mine?role=${role}&status=${encodeURIComponent(status)}`,
    undefined,
    true
  );
}

/** POST /api/offers/:id/accept — creates a payment-window order at the offer
 *  price (winner-order mechanics: reservation + 30-min window + push to the
 *  buyer). The created order rides back in the response. */
export function acceptOffer(offerId: string) {
  return j<{
    ok: boolean;
    orderId?: string;
    order?: { id?: string; amount?: number };
    paymentWindowExpiresAt?: string;
  }>(
    `/api/offers/${encodeURIComponent(offerId)}/accept`,
    { method: 'POST', body: JSON.stringify({}) },
    true
  );
}

/** POST /api/offers/:id/decline. */
export function declineOffer(offerId: string) {
  return j<{ ok: boolean }>(
    `/api/offers/${encodeURIComponent(offerId)}/decline`,
    { method: 'POST', body: JSON.stringify({}) },
    true
  );
}

/** Flash-sale window the spec's route accepts. */
export const FLASH_MINUTES_MIN = 1;
export const FLASH_MINUTES_MAX = 60;

/** POST /api/products/:id/flash { pricePaise, minutes } (seller, in-show) —
 *  writes product.flashSale = { pricePaise, endsAt }; buy-now then charges
 *  the flash price server-side while now < endsAt. `minutes: 0` asks the
 *  server to CLEAR an active flash early — the spec only defines 1–60, so
 *  the backend may reject it; callers fail soft (the flash lapses on its
 *  own endsAt regardless). */
export function setFlashSale(productId: string, pricePaise: number, minutes: number) {
  return j<{ ok: boolean; flashSale: { pricePaise: number; endsAt: string } | null }>(
    `/api/products/${encodeURIComponent(productId)}/flash`,
    { method: 'POST', body: JSON.stringify({ pricePaise, minutes }) },
    true
  );
}

/** The server's own sentence out of a thrown j() error, or the fallback.
 *  j() throws `HTTP <status> <body>`; the body's `message` field is written
 *  for humans, so it is what the UI should show. */
export function serverMessage(err: unknown, fallback: string): string {
  const text = err instanceof Error ? err.message : String(err);
  const m = text.match(/"message"\s*:\s*"([^"]+)"/);
  return m?.[1] ?? fallback;
}

/** Order status → how it should read and which tone it carries.
 *
 *  The statuses the backend actually writes to order docs are
 *  `pending_payment` → `paid`, with `payment_expired` / `payment_failed`
 *  when the window lapses and `late_success_review` when a payment lands
 *  after the unit is gone. Labels mirror the web client's vocabulary
 *  (ShipmentsPanel / LiveRoomPage); the rest are kept defensively.
 *  Anything unmapped should fall back to humanizeStatus (lib/commerce),
 *  never to the raw snake_case value. */
export const ORDER_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  paid: { label: 'Paid', tone: 'ok' },
  confirmed: { label: 'Confirmed', tone: 'ok' },
  shipped: { label: 'Shipped', tone: 'ok' },
  delivered: { label: 'Delivered', tone: 'ok' },
  pending: { label: 'Awaiting payment', tone: 'warn' },
  created: { label: 'Awaiting payment', tone: 'warn' },
  pending_payment: { label: 'Awaiting payment', tone: 'warn' },
  late_success_review: { label: 'Under review', tone: 'warn' },
  payment_expired: { label: 'Payment expired', tone: 'bad' },
  payment_failed: { label: 'Payment failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  refunded: { label: 'Refunded', tone: 'muted' },
  failed: { label: 'Payment failed', tone: 'bad' },
};
