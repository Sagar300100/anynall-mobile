// Follows — mobile port of the website's src/services/follows.ts.
//
// Rows live in `follows/{followerUid}_{targetUid}` — the id shape
// firestore.rules already expects; the rules enforce that the follower is the
// caller. Instagram semantics on top: following a PRIVATE account creates a
// `followRequests/{requesterUid}_{targetUid}` row the target must accept.
// Counts come from server-side aggregation (getCountFromServer) so we never
// do cross-user counter writes.
//
// The original follow()/unfollow()/isFollowing() trio is kept unchanged — the
// live room's follow button uses it against public sellers.
import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { auth, db } from './firebase';
import { getPublicProfile, lookupUidByUsername } from './users';

const rowId = (followerUid: string, targetUid: string) => `${followerUid}_${targetUid}`;
const requestId = (requesterUid: string, targetUid: string) => `${requesterUid}_${targetUid}`;

/** Instagram-style relationship state toward a target user. */
export type FollowStatus = 'none' | 'following' | 'requested';

export interface PersonRef {
  uid: string;
  name: string;
  username: string;
  photoURL: string;
}

// ── Original trio (live-room follow button) ────────────────────────────────

/** Null when signed out — the caller shows the button in its default state. */
export async function isFollowing(targetUid: string): Promise<boolean | null> {
  const uid = auth.currentUser?.uid;
  if (!uid || !targetUid) return null;
  try {
    const snap = await getDoc(doc(db, 'follows', rowId(uid, targetUid)));
    return snap.exists();
  } catch {
    return null;
  }
}

export async function follow(targetUid: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('NOT_SIGNED_IN');
  if (uid === targetUid) throw new Error('CANNOT_FOLLOW_SELF');
  await setDoc(doc(db, 'follows', rowId(uid, targetUid)), {
    followerId: uid,
    targetId: targetUid,
    createdAt: new Date().toISOString(),
  });
}

export async function unfollow(targetUid: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('NOT_SIGNED_IN');
  await deleteDoc(doc(db, 'follows', rowId(uid, targetUid)));
}

// ── Instagram semantics (profile screens) ──────────────────────────────────

/**
 * Follow a user. Public target → follow immediately ("following"). PRIVATE
 * target → create a follow REQUEST the target must accept ("requested").
 * Idempotent either way.
 */
export async function followUser(targetUid: string): Promise<FollowStatus> {
  const me = auth.currentUser;
  if (!me) throw new Error('Sign in to follow people.');
  if (!targetUid) throw new Error('Invalid user.');
  if (me.uid === targetUid) throw new Error("You can't follow yourself.");

  const prof = await getPublicProfile(targetUid);
  if (prof?.isPrivate) {
    await setDoc(
      doc(db, 'followRequests', requestId(me.uid, targetUid)),
      {
        requesterId: me.uid,
        targetId: targetUid,
        requesterName: me.displayName || '',
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    return 'requested';
  }

  // merge:true → idempotent; re-following is a no-op, not an error.
  await setDoc(
    doc(db, 'follows', rowId(me.uid, targetUid)),
    { followerId: me.uid, targetId: targetUid, createdAt: serverTimestamp() },
    { merge: true }
  );
  return 'following';
}

/** Has the signed-in user a still-pending request to target? */
export async function hasRequested(targetUid: string): Promise<boolean> {
  const me = auth.currentUser;
  if (!me || !targetUid) return false;
  const snap = await getDoc(doc(db, 'followRequests', requestId(me.uid, targetUid))).catch(
    () => null
  );
  return !!snap?.exists();
}

/** Combined state — drives the Follow / Requested / Following button. */
export async function getFollowStatus(targetUid: string): Promise<FollowStatus> {
  if (await isFollowing(targetUid)) return 'following';
  if (await hasRequested(targetUid)) return 'requested';
  return 'none';
}

/** Cancel my pending request to target. Idempotent. */
export async function cancelFollowRequest(targetUid: string): Promise<void> {
  const me = auth.currentUser;
  if (!me || !targetUid) return;
  await deleteDoc(doc(db, 'followRequests', requestId(me.uid, targetUid))).catch(() => {});
}

/** Incoming follow requests (people waiting for the caller's approval). */
export async function listIncomingRequests(): Promise<PersonRef[]> {
  const me = auth.currentUser;
  if (!me) return [];
  try {
    const snap = await getDocs(
      query(collection(db, 'followRequests'), where('targetId', '==', me.uid))
    );
    const refs = snap.docs.map((d) => {
      const x = d.data() as any;
      return { uid: x.requesterId || '', name: x.requesterName || '', username: '' };
    });
    return enrichPeople(refs.filter((r) => r.uid));
  } catch {
    return [];
  }
}

/**
 * Accept a request: atomically create the follows row (allowed by rules
 * because the pending request exists) and delete the request.
 */
export async function acceptFollowRequest(requesterUid: string): Promise<void> {
  const me = auth.currentUser;
  if (!me || !requesterUid) return;
  const batch = writeBatch(db);
  batch.set(doc(db, 'follows', rowId(requesterUid, me.uid)), {
    followerId: requesterUid,
    targetId: me.uid,
    createdAt: serverTimestamp(),
  });
  batch.delete(doc(db, 'followRequests', requestId(requesterUid, me.uid)));
  await batch.commit();
}

/** Decline a request — just removes it. */
export async function declineFollowRequest(requesterUid: string): Promise<void> {
  const me = auth.currentUser;
  if (!me || !requesterUid) return;
  await deleteDoc(doc(db, 'followRequests', requestId(requesterUid, me.uid))).catch(() => {});
}

/** Follower / following counts via aggregation (no stale counters). */
export async function getFollowCounts(
  uid: string
): Promise<{ followers: number; following: number }> {
  try {
    const followers = query(collection(db, 'follows'), where('targetId', '==', uid));
    const following = query(collection(db, 'follows'), where('followerId', '==', uid));
    const [a, b] = await Promise.all([
      getCountFromServer(followers),
      getCountFromServer(following),
    ]);
    return { followers: a.data().count, following: b.data().count };
  } catch {
    return { followers: 0, following: 0 };
  }
}

// ── People lists ───────────────────────────────────────────────────────────

// Fill in name/username/photo from publicProfiles for refs that lack them.
async function enrichPeople(
  refs: { uid: string; name?: string; username?: string }[]
): Promise<PersonRef[]> {
  const out: PersonRef[] = [];
  for (const r of refs) {
    let { name = '', username = '' } = r;
    let photoURL = '';
    if (r.uid && (!name || !username)) {
      const p = await getPublicProfile(r.uid).catch(() => null);
      if (p) {
        name = name || p.displayName;
        username = username || p.username;
        photoURL = p.photoURL;
      }
    }
    out.push({ uid: r.uid, name: name || username || 'User', username, photoURL });
  }
  return out;
}

/** People a given user follows. Handles both follow schemas in `follows`. */
export async function listFollowingOf(uid: string): Promise<PersonRef[]> {
  if (!uid) return [];
  try {
    const snap = await getDocs(query(collection(db, 'follows'), where('followerId', '==', uid)));
    const refs = await Promise.all(
      snap.docs.map(async (d) => {
        const x = d.data() as any;
        let target = x.targetId || '';
        let username = '';
        // Legacy seller-follow rows key the target by handle, not uid.
        if (!target && x.sellerId) {
          username = x.sellerId;
          target = (await lookupUidByUsername(x.sellerId)) || '';
        }
        return { uid: target, name: x.sellerName || '', username };
      })
    );
    return enrichPeople(refs.filter((r) => r.uid));
  } catch {
    return [];
  }
}

/** People who follow a given user. */
export async function listFollowersOf(uid: string): Promise<PersonRef[]> {
  if (!uid) return [];
  try {
    const snap = await getDocs(query(collection(db, 'follows'), where('targetId', '==', uid)));
    const refs = snap.docs.map((d) => {
      const x = d.data() as any;
      return { uid: x.followerId || '', name: x.followerName || '', username: '' };
    });
    return enrichPeople(refs.filter((r) => r.uid));
  } catch {
    return [];
  }
}
