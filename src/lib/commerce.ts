// src/lib/commerce.ts — mobile port of the web app's auction/commerce/payment
// clients (services/api.ts + services/payments.ts). Same backend contract:
// all amounts are INTEGER PAISE (₹100 = 10000); the server re-validates
// everything on every call, so these are thin wrappers.
import { j } from './api';

// =====================================================
//                     AUCTIONS
// =====================================================
export interface AuctionRecord {
  id: string;
  productId: string;
  showId?: string | null;
  startPrice: number;
  bidStep: number;
  currentBid: number;
  currentBidderUid?: string | null;
  currentBidderName?: string | null;
  bidCount?: number;
  endsAt?: string | null;
  // open | awaiting_winner_payment | paid | payment_failed | unsold | cancelled
  status: string;
  winnerUid?: string | null;
  paymentWindowExpiresAt?: string | null;
  /** Mirrored onto the doc at settlement precisely so the winner's payment
   *  drawer can show the same bid + shipping = total the order actually
   *  charges. Razorpay charges winningTotalAmount — displaying currentBid
   *  alone under-quotes any lot whose product carries a shipping fee. */
  winningBidAmount?: number;
  winningShippingFee?: number;
  winningTotalAmount?: number;
  /** Anti-sniping disabled for this lot: the clock never extends, so whoever
   *  leads at zero wins. Snapshotted onto the auction when it starts. */
  suddenDeath?: boolean;
  version?: number;
}

/** Seller starts a lot. The server re-validates everything (ownership, stock,
 *  "one open auction per show") and snapshots the show's verified-buyers flag
 *  onto the auction. `suddenDeath` defaults to whatever the listing was
 *  created with when omitted. */
export function createAuction(p: {
  productId: string;
  showId: string;
  /** Paise. */
  startPrice: number;
  /** Paise. Server defaults to ₹100 when omitted. */
  bidStep?: number;
  /** 15–900, clamped server-side. */
  durationSeconds?: number;
  suddenDeath?: boolean;
}) {
  return j<{ id: string; endsAt: string; status: string; suddenDeath: boolean }>(
    '/api/auctions',
    { method: 'POST', body: JSON.stringify(p) },
    true
  );
}

/** Minimum acceptable next bid, mirroring the server's transaction rule. */
export function minNextBid(a: Pick<AuctionRecord, 'bidCount' | 'currentBid' | 'bidStep' | 'startPrice'>) {
  return (a.bidCount || 0) > 0 ? (a.currentBid || 0) + (a.bidStep || 100) : a.startPrice;
}

/** Place a bid (paise). The idempotencyKey makes retries/double-taps safe. */
export function placeBid(auctionId: string, amountPaise: number, idempotencyKey: string) {
  return j<{ ok: boolean; bid: { amount: number; endsAt: string; version: number; extended: boolean } }>(
    `/api/auctions/${auctionId}/bid`,
    { method: 'POST', body: JSON.stringify({ amount: amountPaise, idempotencyKey }) },
    true
  );
}

/** Request finalisation once the displayed timer hits zero — the backend
 *  transaction decides; safe to call repeatedly from any participant. */
export function finalizeAuction(auctionId: string) {
  return j<{ ok: boolean; result: string }>(
    `/api/auctions/${auctionId}/finalize`,
    { method: 'POST', body: JSON.stringify({}) },
    true
  );
}

/** Winner-only: create/reuse the Razorpay order for the winning amount.
 *  `useCredit` (spec Gap 6, additive) asks the server to deduct referral
 *  credit transactionally; the returned `amount` is then the discounted
 *  remainder Razorpay charges, with `creditApplied`/`firstBuyDiscount`
 *  surfaced for display when present. */
export function createAuctionWinnerOrder(
  auctionId: string,
  shipping?: ShippingAddress,
  useCredit?: boolean
) {
  return j<{
    orderId: string;
    commerceOrderId: string;
    amount: number;
    currency: 'INR';
    keyId: string;
    productTitle: string;
    paymentWindowExpiresAt: string;
    customerId?: string | null;
    /** Paise of referral credit the server deducted (absent/0 = none). */
    creditApplied?: number;
    /** First-purchase discount, when the server applied one. */
    firstBuyDiscount?: number | { amountPaise?: number; percent?: number } | null;
  }>(
    `/api/auctions/${auctionId}/winner-order`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...(shipping ? { shipping } : {}),
        ...(useCredit ? { useCredit: true } : {}),
      }),
    },
    true
  );
}

/** Winner/seller: release the reservation after window + backend grace. */
export function auctionPaymentExpired(auctionId: string) {
  return j<{ ok: boolean; result: string }>(
    `/api/auctions/${auctionId}/payment-expired`,
    { method: 'POST', body: JSON.stringify({}) },
    true
  );
}

// =====================================================
//          COMMERCE PROFILE (bid readiness)
// =====================================================
export interface ShippingAddress {
  name: string;
  phone: string; // 10-digit Indian mobile
  line1: string;
  line2?: string;
  city: string;
  stateCode: string; // 2-digit GST state code (constants/in-states)
  pincode: string; // 6 digits
}

export interface CommerceProfile {
  savedAddress: ShippingAddress | null;
  preferredMethod: 'upi' | 'card' | null;
  auctionTermsAccepted: boolean;
  auctionTermsVersion: string;
  unpaidWins: number;
  maxUnpaidWins: number;
  emailVerified: boolean;
  /** Referral credit balance in paise (spec Gap 6) — additive; absent until
   *  the backend wave surfaces users/{uid}.creditPaise here. Missing = 0,
   *  and 0 hides every credit affordance. */
  creditPaise?: number;
}

/** May this buyer purchase from this show's seller?
 *
 *  A composition or eligible-unregistered seller may only deliver inside their
 *  own State, so an out-of-State buyer can watch but not buy. The purchase
 *  paths enforce this anyway; this is what lets the room disable the button
 *  and explain why, instead of failing after the buyer has committed. */
export interface BuyEligibility {
  allowed: boolean;
  code?: string;
  message?: string;
}

export function canBuyFromShow(showId: string) {
  return j<BuyEligibility>(
    `/api/commerce/can-buy?showId=${encodeURIComponent(showId)}`,
    undefined,
    true
  );
}

export function getCommerceProfile() {
  return j<CommerceProfile>('/api/commerce/profile', { method: 'GET' }, true);
}

export function saveCommerceProfile(patch: {
  savedAddress?: ShippingAddress;
  preferredMethod?: 'upi' | 'card';
  acceptAuctionTerms?: boolean;
}) {
  return j<{ ok: boolean }>(
    '/api/commerce/profile',
    { method: 'POST', body: JSON.stringify(patch) },
    true
  );
}

/** True once the profile satisfies every server-side bid precondition. */
export function isReadyToBid(p: CommerceProfile | null): boolean {
  return !!(
    p &&
    p.emailVerified &&
    p.savedAddress &&
    p.preferredMethod &&
    p.auctionTermsAccepted &&
    p.unpaidWins < p.maxUnpaidWins
  );
}

// =====================================================
//                     BUY NOW
// =====================================================
export interface BuyNowOrder {
  orderId: string;
  commerceOrderId: string;
  amount: number; // paise (product price + seller's shipping fee, minus any credit/discount)
  currency: 'INR';
  keyId: string;
  productTitle: string;
  customerId?: string | null;
  /** Paise of referral credit the server deducted (spec Gap 6; absent/0 = none). */
  creditApplied?: number;
  /** First-purchase discount, when the server applied one (spec Gap 6). */
  firstBuyDiscount?: number | { amountPaise?: number; percent?: number } | null;
}

/**
 * Reserve one unit of a live-show product and create its Razorpay order.
 * The price is read server-side from the product doc — the client never
 * supplies an amount. 409s carry human-readable reasons (SOLD_OUT,
 * INTERSTATE_BLOCKED, …) in the response body.
 *
 * `idempotencyKey` (optional, server-accepted): one key per purchase INTENT,
 * so a double-tap or an app-level retry replays the same reservation instead
 * of reserving a second unit. The caller owns the key's lifetime — see
 * BuyNowSheet, which holds one key per product until the purchase SUCCEEDS
 * (cleared via clearBuyNowIntent from the checkout's onSuccess).
 */
export function createBuyNowOrder(
  productId: string,
  shipping: ShippingAddress,
  idempotencyKey?: string,
  /** Spec Gap 6 (additive): ask the server to spend referral credit on this
   *  order. The deduction happens inside the server's idempotency fencing —
   *  replays with the same key never double-deduct. */
  useCredit?: boolean
) {
  return j<BuyNowOrder>(
    '/api/orders/buy-now',
    {
      method: 'POST',
      body: JSON.stringify({
        productId,
        shipping,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(useCredit ? { useCredit: true } : {}),
      }),
    },
    true
  );
}

// =====================================================
//                       TIPS
// =====================================================
/** Server bounds mirrored client-side (₹10–₹10,000), in paise. */
export const TIP_MIN_PAISE = 10 * 100;
export const TIP_MAX_PAISE = 10_000 * 100;

/**
 * POST /api/shows/:id/tip { amountPaise } — a Razorpay order of type 'tip'
 * (100% to the seller, no fee; on verify the server writes the payout row and
 * announces "🎉 X tipped ₹Y" in chat). Returns the SAME checkout order shape
 * as buy-now, so RazorpayCheckout takes it unchanged.
 *
 * `idempotencyKey`: one key per tip INTENT (the server runs the full
 * claim/fence lifecycle on it), so a double-tap or a network retry replays
 * the same paymentOrder instead of minting another paid-API Razorpay order.
 * The caller owns the key's lifetime — see TipSheet, which mints per open.
 */
export function createTipOrder(showId: string, amountPaise: number, idempotencyKey?: string) {
  return j<BuyNowOrder>(
    `/api/shows/${encodeURIComponent(showId)}/tip`,
    {
      method: 'POST',
      body: JSON.stringify({
        amountPaise,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }),
    },
    true
  );
}

// =====================================================
//                  OFFERS (buyer)
// =====================================================
/** Offers must be 40–100% of the list price — mirrored so the sheet can
 *  explain the bounds before spending a request, never instead of the server
 *  validating. */
export const OFFER_MIN_RATIO = 0.4;

export interface OfferCreated {
  ok?: boolean;
  id?: string;
  status?: string;
  /** Creation + 24h — the window the seller has to respond. */
  expiresAt?: string;
}

/**
 * POST /api/products/:id/offer { amountPaise } — an offer on an active Buy It
 * Now product. The server enforces ONE open offer per buyer+product and
 * answers 409 with a human-readable message otherwise; callers show that
 * message rather than guessing.
 */
export function makeOffer(productId: string, amountPaise: number) {
  return j<OfferCreated>(
    `/api/products/${encodeURIComponent(productId)}/offer`,
    { method: 'POST', body: JSON.stringify({ amountPaise }) },
    true
  );
}

// =====================================================
//                     PAYMENTS
// =====================================================
/** GET /api/payments/config — the PUBLIC Razorpay key id for Checkout.
 *  Needed when the checkout params weren't handed to this device by the
 *  order-creating call (paying an accepted offer from the orders list). */
export function getPaymentsConfig() {
  return j<{ keyId: string; currency: string }>('/api/payments/config', { method: 'GET' });
}

export interface VerifyPayload {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface VerifyResult {
  ok: boolean;
  status: 'paid';
  orderId: string;
  paymentId: string;
}

/** HMAC-check the checkout success payload server-side; marks the order paid. */
export function verifyPayment(payload: VerifyPayload) {
  return j<VerifyResult>(
    '/api/payments/verify',
    { method: 'POST', body: JSON.stringify(payload) },
    true
  );
}

// =====================================================
//                     HELPERS
// =====================================================
/** Idempotency key matching the server's /^[A-Za-z0-9_-]{8,64}$/ rule.
 *  Math.random is fine here — uniqueness only needs to hold per user per
 *  auction for the dedupe window, not be cryptographic. */
export function newIdempotencyKey(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 24; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${Date.now().toString(36)}_${out}`;
}

export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/** Fallback for a status value no label map knows: de-snake and title-case it
 *  ('late_success_review' → 'Late Success Review') so a new backend status
 *  reads as words on screen, never raw snake_case. */
export function humanizeStatus(status: string): string {
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
