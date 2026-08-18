// Follows — everyone can follow everyone, buyer or seller alike.
//
// Rows live in `follows/{followerUid}_{targetUid}` — the id shape
// firestore.rules already expects; the rules enforce that the follower is the
// caller. PRODUCT DECISION: there are no private accounts and no follow
// requests — following always succeeds immediately (the earlier
// Instagram-style request model was removed on review). Counts come from
// server-side aggregation (getCountFromServer) so we never do cross-user
// counter writes.
//
// The original follow()/unfollow()/isFollowing() trio is kept unchanged — the
// live room's follow button uses it.
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
} from 'firebase/firestore';

import { auth, db } from './firebase';
import { getPublicProfile, lookupUidByUsername } from './users';

const rowId = (followerUid: string, targetUid: string) => `${followerUid}_${targetUid}`;

/** Relationship toward a target user. */
export type FollowStatus = 'none' | 'following';

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

// ── Profile-screen helpers ─────────────────────────────────────────────────

/** Follow a user — always immediate; idempotent (re-following is a no-op). */
export async function followUser(targetUid: string): Promise<FollowStatus> {
  const me = auth.currentUser;
  if (!me) throw new Error('Sign in to follow people.');
  if (!targetUid) throw new Error('Invalid user.');
  if (me.uid === targetUid) throw new Error("You can't follow yourself.");

  await setDoc(
    doc(db, 'follows', rowId(me.uid, targetUid)),
    { followerId: me.uid, targetId: targetUid, createdAt: serverTimestamp() },
    { merge: true }
  );
  return 'following';
}

/** Current relationship — drives the Follow / Following button. */
export async function getFollowStatus(targetUid: string): Promise<FollowStatus> {
  return (await isFollowing(targetUid)) ? 'following' : 'none';
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
