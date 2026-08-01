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
  version?: number;
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

/** Winner-only: create/reuse the Razorpay order for the winning amount. */
export function createAuctionWinnerOrder(auctionId: string, shipping?: ShippingAddress) {
  return j<{
    orderId: string;
    commerceOrderId: string;
    amount: number;
    currency: 'INR';
    keyId: string;
    productTitle: string;
    paymentWindowExpiresAt: string;
    customerId?: string | null;
  }>(
    `/api/auctions/${auctionId}/winner-order`,
    { method: 'POST', body: JSON.stringify(shipping ? { shipping } : {}) },
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
//                     PAYMENTS
// =====================================================
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
