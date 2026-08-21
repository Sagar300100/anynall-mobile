// src/lib/giveaways.ts — buyer-side giveaway entries (Gap 8, in-room features).
//
// Entries are DIRECT Firestore writes, the only client-written commerce
// collection: shows/{showId}/giveawayEntries/{productId}_{uid} with
// { productId, uid, name, createdAt }. Rules (added alongside this wave)
// allow a signed-in user to CREATE an entry with their own uid, create-only,
// and only while the product's kind is 'giveaway'. Until those rules deploy,
// every write fails permission-denied — callers surface an honest notice via
// isPermissionDenied, never a fake success. The draw itself is server-only
// (see seller-hub.drawGiveawayWinner).
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

import { auth, db } from './firebase';

/** One entry per user per giveaway, enforced by the doc id itself. */
export function giveawayEntryId(productId: string, uid: string): string {
  return `${productId}_${uid}`;
}

/** Enter a giveaway. Create-only by rules, so re-entering is refused server
 *  side — callers check hasEntered() first and treat the button as done. */
export async function enterGiveaway(showId: string, productId: string): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error('Sign in to enter the giveaway.');
  await setDoc(
    doc(db, 'shows', showId, 'giveawayEntries', giveawayEntryId(productId, u.uid)),
    {
      productId,
      uid: u.uid,
      // Rules cap name at 60 chars (firestore.rules giveawayEntries block) and
      // a rules refusal reads as "entries aren't switched on" — so a long
      // display name must be clamped HERE, the same slice the server's own
      // name handling applies, or such users can never enter.
      name: (u.displayName || u.email?.split('@')[0] || 'buyer').slice(0, 60),
      createdAt: serverTimestamp(),
    }
  );
}

/** Has the signed-in user already entered? False when signed out. */
export async function hasEntered(showId: string, productId: string): Promise<boolean> {
  const u = auth.currentUser;
  if (!u) return false;
  const snap = await getDoc(
    doc(db, 'shows', showId, 'giveawayEntries', giveawayEntryId(productId, u.uid))
  );
  return snap.exists();
}

/** How many entries a giveaway has — a count AGGREGATE, so one read no matter
 *  how many people entered. Throws when rules deny the read; callers treat
 *  that as "count unknown", never as zero. */
export async function entryCount(showId: string, productId: string): Promise<number> {
  const q = query(
    collection(db, 'shows', showId, 'giveawayEntries'),
    where('productId', '==', productId)
  );
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

/** Firestore's rules refusal — the one failure that means "not switched on
 *  yet" rather than "try again". */
export function isPermissionDenied(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'permission-denied';
}

/** Firestore's failed-precondition — the write's preconditions don't hold
 *  right now (e.g. the giveaway product changed under the entry). Distinct
 *  from permission-denied: retrying can genuinely succeed, so callers must
 *  not present it as "the feature isn't enabled". */
export function isFailedPrecondition(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'failed-precondition';
}
