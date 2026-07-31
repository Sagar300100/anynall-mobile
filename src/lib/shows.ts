// src/lib/shows.ts — mobile port of the web app's services/showsfirestore.ts.
// Shows live in the `shows` Firestore collection (public read per
// firestore.rules); the deployed HTTP API has no /api/shows route, so this is
// the same source of truth the website uses.
import { collection, getDocs, orderBy, query } from 'firebase/firestore';

import type { ShowData } from './api';
import { db } from './firebase';

function toUI(id: string, d: any): ShowData {
  const when = d?.scheduled_time ? new Date(d.scheduled_time) : null;

  return {
    id,
    name: d?.title ?? d?.name ?? 'Untitled Show',
    date: when ? when.toISOString().slice(0, 10) : 'TBD',
    time: when ? when.toTimeString().slice(0, 5) : 'TBD',
    category: d?.category ?? 'Uncategorized',
    subcategory: d?.subcategory ?? '',
    sellingFormat: d?.sellingFormat ?? 'Auction',
    brand: d?.brand ?? 'N/A',
    shippedFrom: d?.shippedFrom ?? 'N/A',
    sellerRating: typeof d?.sellerRating === 'number' ? d.sellerRating : 4.5,
    tags: Array.isArray(d?.tags) ? d.tags : [],
    isLive: !!d?.isLive,
    thumbnail: d?.thumbnail_url ?? d?.thumbnail ?? '',
    seller:
      d?.seller?.username ??
      d?.sellerUsername ??
      (typeof d?.seller === 'string' ? d.seller : 'Anonymous'),
    title: d?.title,
    thumbnail_url: d?.thumbnail_url,
    scheduled_time: d?.scheduled_time ?? null,
    sellerId: d?.sellerId ?? undefined,
    sellerObj: d?.sellerObj ?? null,
    ownerUid: d?.ownerUid ?? null,
    replayUrl: d?.replay_url ?? null,
  };
}

export async function fsFetchShows(): Promise<ShowData[]> {
  const q = query(collection(db, 'shows'), orderBy('scheduled_time', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => toUI(d.id, d.data()));
}
