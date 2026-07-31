// src/lib/chat.ts — mobile port of the web app's services/chatFirestore.ts.
// Live-show chat lives at shows/{showId}/chat; rules require uid == auth.uid
// on writes, public read follows the show's visibility.
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';

import { auth, db } from './firebase';

export type ChatDoc = {
  uid?: string;
  user: string;
  avatar?: string;
  text: string;
  isBid?: boolean;
  createdAt: Timestamp | null;
};

/** Subscribe to messages for a show (ascending by time). Returns unsubscribe fn. */
export function subscribeMessages(showId: string, onChange: (docs: ChatDoc[]) => void) {
  const colRef = collection(db, 'shows', showId, 'chat');
  const q = query(colRef, orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => d.data() as ChatDoc));
  });
}

/** Persist a message; requires a signed-in user (enforced by firestore.rules). */
export async function sendMessage(
  showId: string,
  payload: { user: string; text: string; avatar?: string; isBid?: boolean }
) {
  const u = auth.currentUser;
  if (!u) throw new Error('Sign in to send messages');

  await addDoc(collection(db, 'shows', showId, 'chat'), {
    uid: u.uid,
    user: payload.user,
    text: payload.text,
    avatar: payload.avatar ?? payload.user.slice(0, 2).toUpperCase(),
    isBid: !!payload.isBid,
    createdAt: serverTimestamp(),
  });
}
