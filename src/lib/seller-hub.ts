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
  category: string;
  condition: string;
  sku: string;
  hazmat: string;
  showId: string | null;
  /** Show-scoped listing: never browsable in the marketplace. */
  temporary: boolean;
  auctionConfig: AuctionConfig | null;
  /** Seller-private margin data; absent unless they set one. */
  costPaise: number | null;
  createdAtMs: number;
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
  /** Paise breakdown when present: { itemSubtotal, shippingFee, total }. */
  pricing: { itemSubtotal?: number; shippingFee?: number; total?: number } | null;
  /** Shiprocket booking state — see lib/shipping.ts Shipment. */
  shipment: import('./shipping').Shipment | null;
  createdAt: string | null;
  createdAtMs: number;
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

export type ProductKind = 'buy-it-now' | 'auction' | 'giveaway';

export const PRODUCT_KINDS: { value: ProductKind; label: string; hint: string }[] = [
  { value: 'buy-it-now', label: 'Buy Now', hint: 'Sells at a fixed price' },
  { value: 'auction', label: 'Auction', hint: 'Buyers bid during a live show' },
  { value: 'giveaway', label: 'Giveaway', hint: 'Free — no payment taken' },
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

/** Order status → how it should read and which tone it carries. */
export const ORDER_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  paid: { label: 'Paid', tone: 'ok' },
  confirmed: { label: 'Confirmed', tone: 'ok' },
  shipped: { label: 'Shipped', tone: 'ok' },
  delivered: { label: 'Delivered', tone: 'ok' },
  pending: { label: 'Awaiting payment', tone: 'warn' },
  created: { label: 'Awaiting payment', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  refunded: { label: 'Refunded', tone: 'muted' },
  failed: { label: 'Payment failed', tone: 'bad' },
};
