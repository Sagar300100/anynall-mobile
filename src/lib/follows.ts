// Follows — mobile port of the website's src/services/follows.ts, including
// Instagram-style private accounts and follow requests.
//
// Rows live in `follows/{followerUid}_{targetUid}` with fields
// { followerId, targetId, createdAt }. firestore.rules allows a DIRECT create
// only when the target's publicProfiles doc is not private; private targets go
// through `followRequests/{requesterUid}_{targetUid}` instead, and the TARGET
// materializes the follows row when accepting (batch: create row + delete
// request — the rules' accept path). Rules DENY updates to an existing follows
// row, so a re-follow must be detected client-side and skipped: a setDoc over
// an existing row is PERMISSION_DENIED, not an idempotent no-op.
//
// Counts come from server-side aggregation (getCountFromServer) so we never do
// cross-user counter writes.
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

const followDocId = (followerUid: string, targetUid: string) => `${followerUid}_${targetUid}`;
const requestDocId = (requesterUid: string, targetUid: string) => `${requesterUid}_${targetUid}`;

/** Instagram-style relationship state toward a target user. */
export type FollowStatus = 'none' | 'following' | 'requested';

export interface PersonRef {
  uid: string;
  name: string;
  username: string;
  photoURL: string;
}

// ── Relationship state ─────────────────────────────────────────────────────

export async function isFollowing(targetUid: string): Promise<boolean> {
  const me = auth.currentUser;
  if (!me || !targetUid) return false;
  const snap = await getDoc(doc(db, 'follows', followDocId(me.uid, targetUid))).catch(() => null);
  return !!snap?.exists();
}

/** Has the signed-in user already sent a (still pending) request to target? */
export async function hasRequested(targetUid: string): Promise<boolean> {
  const me = auth.currentUser;
  if (!me || !targetUid) return false;
  const snap = await getDoc(
    doc(db, 'followRequests', requestDocId(me.uid, targetUid))
  ).catch(() => null);
  return !!snap?.exists();
}

/** Combined state — drives the Follow / Requested / Following button. */
export async function getFollowStatus(targetUid: string): Promise<FollowStatus> {
  if (await isFollowing(targetUid)) return 'following';
  if (await hasRequested(targetUid)) return 'requested';
  return 'none';
}

// ── Follow / unfollow / requests ───────────────────────────────────────────

/**
 * Follow a user — Instagram semantics. Public target → follow immediately
 * (returns "following"). PRIVATE target → create a follow REQUEST the target
 * must accept (returns "requested"). Idempotent either way — an existing
 * row/request is left untouched (rules deny updates, so writing over one
 * would be PERMISSION_DENIED, not a no-op).
 */
export async function followUser(targetUid: string): Promise<FollowStatus> {
  const me = auth.currentUser;
  if (!me) throw new Error('Sign in to follow people.');
  if (!targetUid) throw new Error('Invalid user.');
  if (me.uid === targetUid) throw new Error("You can't follow yourself.");

  const prof = await getPublicProfile(targetUid);
  if (prof?.isPrivate) {
    // ALREADY FOLLOWING wins over everything: a follower who taps Follow
    // before the button state resolves must not file a request — the target
    // could never accept it (the accept batch would try to create a follows
    // row that already exists, which rules treat as a denied update).
    if (await isFollowing(targetUid)) return 'following';
    if (await hasRequested(targetUid)) return 'requested';
    await setDoc(doc(db, 'followRequests', requestDocId(me.uid, targetUid)), {
      requesterId: me.uid,
      targetId: targetUid,
      requesterName: me.displayName || '',
      createdAt: serverTimestamp(),
    });
    return 'requested';
  }

  const ref = doc(db, 'follows', followDocId(me.uid, targetUid));
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists()) return 'following'; // re-follow is a no-op
  await setDoc(ref, {
    followerId: me.uid,
    targetId: targetUid,
    createdAt: serverTimestamp(),
  });
  return 'following';
}

export async function unfollowUser(targetUid: string): Promise<void> {
  const me = auth.currentUser;
  if (!me || !targetUid) return;
  // Idempotent for the normal case (deleting a non-existent doc succeeds) —
  // but real failures MUST throw: the callers roll their optimistic UI back
  // in a catch, and a swallowed rejection here left the screen confirming an
  // unfollow the server never saw.
  await deleteDoc(doc(db, 'follows', followDocId(me.uid, targetUid)));
}

/** Cancel my pending follow request to target. Real failures throw (callers
 *  roll back optimistic state); deleting a non-existent request succeeds. */
export async function cancelFollowRequest(targetUid: string): Promise<void> {
  const me = auth.currentUser;
  if (!me || !targetUid) return;
  await deleteDoc(doc(db, 'followRequests', requestDocId(me.uid, targetUid)));
}

/** Incoming follow requests for the signed-in user (people awaiting approval). */
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
 * Accept a follow request: atomically create the follows row (allowed by the
 * rules' accept path because the pending request exists) and delete the
 * request — one batch, exactly as the web client commits it.
 */
export async function acceptFollowRequest(requesterUid: string): Promise<void> {
  const me = auth.currentUser;
  if (!me || !requesterUid) return;
  const followRef = doc(db, 'follows', followDocId(requesterUid, me.uid));
  // A request can exist for someone who ALREADY follows (filed from a stale
  // button, or created before the account went private). The batch's set()
  // would then be an update on the existing row — which rules deny, failing
  // the whole accept forever. An existing row means there is nothing to
  // grant: just clear the request.
  const existing = await getDoc(followRef).catch(() => null);
  if (existing?.exists()) {
    await deleteDoc(doc(db, 'followRequests', requestDocId(requesterUid, me.uid)));
    return;
  }
  const batch = writeBatch(db);
  batch.set(followRef, {
    followerId: requesterUid,
    targetId: me.uid,
    createdAt: serverTimestamp(),
  });
  batch.delete(doc(db, 'followRequests', requestDocId(requesterUid, me.uid)));
  await batch.commit();
}

/** Decline a follow request — just removes it. */
export async function declineFollowRequest(requesterUid: string): Promise<void> {
  const me = auth.currentUser;
  if (!me || !requesterUid) return;
  await deleteDoc(doc(db, 'followRequests', requestDocId(requesterUid, me.uid))).catch(() => {});
}

// ── Counts ─────────────────────────────────────────────────────────────────

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
