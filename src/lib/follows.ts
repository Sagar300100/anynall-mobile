// Following a seller.
//
// Rows live in `follows/{followerUid}_{targetUid}` — the id shape
// firestore.rules already expects. The rules enforce that the follower is the
// caller and that the target isn't a private account; this module only builds
// the document, it is not the thing that grants permission.
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

import { auth, db } from './firebase';

const rowId = (followerUid: string, targetUid: string) => `${followerUid}_${targetUid}`;

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
