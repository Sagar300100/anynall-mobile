// src/lib/realtime.ts — mobile port of the web app's services/realtime.ts.
// Live-room state (products + auctions) streams straight from Firestore;
// writes always go through the HTTP API, never from the client.
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import type { AuctionRecord } from './commerce';
import { db } from './firebase';

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
 *  identical query). The panel treats items[0] as the current auction. */
export function listenAuctions(showId: string, cb: (auctions: AuctionRecord[]) => void) {
  const q = query(
    collection(db, 'auctions'),
    where('showId', '==', showId),
    orderBy('updatedAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
    (err) => console.warn('[realtime] auctions listener error:', err?.message)
  );
}
