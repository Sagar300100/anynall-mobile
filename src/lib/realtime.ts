// src/lib/realtime.ts — mobile port of the web app's services/realtime.ts.
// Live-room state (products + auctions) streams straight from Firestore;
// writes always go through the HTTP API, never from the client.
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import type { AuctionRecord } from './commerce';
import { db } from './firebase';
import { msUntil } from './server-time';

export interface ProductDoc {
  id: string;
  title: string;
  price: number; // paise
  stock: number;
  reserved: number;
  sold: number;
  kind?: string; // auction | buy-it-now | giveaway
  shippingFee?: number; // paise, 0 = seller absorbs
  auctionConfig?: {
    startPrice: number;
    bidStep: number;
    durationSeconds: number;
    /** Anti-sniping off: the clock is hard, last bid in wins. */
    suddenDeath?: boolean;
  } | null;
  pinned?: boolean;
  thumbnail_url?: string;
  /** new | pre-owned | mint | near-mint | good | fair | poor */
  condition?: string;
  showId?: string | null;
  /** Flash sale (Gap 8) — written by POST /api/products/:id/flash. Buy-now
   *  charges pricePaise while now < endsAt (checked SERVER-side); this field
   *  only drives the strikethrough + countdown display. endsAt may arrive as
   *  an ISO string or a Firestore Timestamp — use activeFlashSale(). */
  flashSale?: { pricePaise: number; endsAt: unknown } | null;
  /** Written by the server when the seller draws the giveaway. */
  giveawayWinner?: { uid: string; name: string; drawnAt?: unknown } | null;
}

/** endsAt as ISO, whichever shape the doc carries: the HTTP route writes an
 *  ISO string; a Firestore serverTimestamp arrives as a Timestamp object. */
export function flashEndsAtIso(f: { endsAt: unknown } | null | undefined): string | null {
  const v = f?.endsAt;
  if (!v) return null;
  if (typeof v === 'string') return v;
  const toDate = (v as { toDate?: () => Date }).toDate;
  if (typeof toDate === 'function') return toDate.call(v).toISOString();
  const secs =
    (v as { seconds?: number }).seconds ?? (v as { _seconds?: number })._seconds;
  if (typeof secs === 'number') return new Date(secs * 1000).toISOString();
  return null;
}

/** The product's flash sale IF it is still running (by the server-corrected
 *  clock), normalised to { pricePaise, endsAt: ISO }. Null once expired or
 *  absent — display logic never has to reason about clock skew itself. */
export function activeFlashSale(
  p: Pick<ProductDoc, 'flashSale'>
): { pricePaise: number; endsAt: string } | null {
  const f = p.flashSale;
  if (!f || typeof f.pricePaise !== 'number' || f.pricePaise <= 0) return null;
  const endsAt = flashEndsAtIso(f);
  if (!endsAt || msUntil(endsAt) <= 0) return null;
  return { pricePaise: f.pricePaise, endsAt };
}

export function listenProducts(showId: string, cb: (products: ProductDoc[]) => void) {
  const q = query(collection(db, 'products'), where('showId', '==', showId));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
    (err) => console.warn('[realtime] products listener error:', err?.message)
  );
}

/** Newest-first auctions for a show — index already exists (web uses the
 *  identical query). The panel treats items[0] as the current auction.
 *
 *  limit(8): unbounded, this streamed EVERY auction the show ever ran to every
 *  viewer — a marathon show's whole lot history re-downloaded per join. The
 *  room only ever needs the open lot, this user's recent unpaid win, and the
 *  just-sold transition doc; 8 covers all of those with margin:
 *    • the OPEN lot is bumped on creation and on every bid, so it lives at or
 *      near the head of the updatedAt-desc window;
 *    • live/[id].tsx's winner-sheet scan (wonAuction) looks for an
 *      awaiting_winner_payment doc whose winner is this user — VERIFIED: that
 *      doc's updatedAt was just bumped by settlement (and again by any payment
 *      webhook), so a recent settlement sits at the head of this window. For
 *      it to fall OUT, eight OTHER docs would need newer updatedAt stamps
 *      during the payment window — i.e. ~7 further lots started/settled while
 *      this winner pays, far beyond how a one-lot-at-a-time show operates;
 *    • the just-sold fallback (auctions[0]) is by definition the newest doc.
 *  The seller room (show-room/[id].tsx) only scans for the open lot, which the
 *  first bullet covers. */
export function listenAuctions(showId: string, cb: (auctions: AuctionRecord[]) => void) {
  const q = query(
    collection(db, 'auctions'),
    where('showId', '==', showId),
    orderBy('updatedAt', 'desc'),
    limit(8)
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
    (err) => console.warn('[realtime] auctions listener error:', err?.message)
  );
}
