// src/lib/chat.ts — mobile port of the web app's services/chatFirestore.ts.
// Live-show chat lives at shows/{showId}/chat; rules require uid == auth.uid
// on BOTH reads and writes (guests cannot subscribe — the room shows a
// sign-in prompt instead of a silently dead listener).
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';

import { auth, db } from './firebase';

export type ChatDoc = {
  /** Firestore doc id — the stable list key. Index keys forced the room's
   *  chat list to re-render every row on every message; doc ids don't. */
  id: string;
  uid?: string;
  user: string;
  avatar?: string;
  text: string;
  isBid?: boolean;
  createdAt: Timestamp | null;
};

/** Newest messages a joining viewer actually needs on screen. Unbounded, the
 *  initial snapshot re-downloaded a marathon show's ENTIRE chat history for
 *  every viewer — thousands of reads per join, growing forever. */
const CHAT_WINDOW = 50;

/** A chat doc regardless of who wrote it. The canonical schema is
 *  { uid, user, avatar, text, createdAt: serverTimestamp } but an earlier
 *  seller-room build wrote { uid, name, text, createdAt: ISO-string } — one
 *  such doc in a show's history crashed the render of every buyer room
 *  ((item.avatar || item.user).slice() on undefined). Normalise here so every
 *  reader survives every writer that ever existed. */
function toChatDoc(id: string, raw: any): ChatDoc {
  const user = String(raw?.user ?? raw?.name ?? 'Someone');
  return {
    id,
    uid: raw?.uid,
    user,
    avatar: raw?.avatar ?? undefined,
    text: String(raw?.text ?? ''),
    isBid: !!raw?.isBid,
    createdAt: raw?.createdAt && typeof raw.createdAt !== 'string' ? raw.createdAt : null,
  };
}

/** Subscribe to the latest messages for a show (ascending by time). Returns
 *  unsubscribe fn. Signed-in only — rules reject guest reads, and the error
 *  callback keeps that from being a silent dead column. */
export function subscribeMessages(
  showId: string,
  onChange: (docs: ChatDoc[]) => void,
  onError?: (err: unknown) => void
) {
  const colRef = collection(db, 'shows', showId, 'chat');
  // Newest-first with a cap, reversed for display — the query form that lets
  // Firestore send the LAST page of history instead of all of it.
  const q = query(colRef, orderBy('createdAt', 'desc'), limit(CHAT_WINDOW));
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs
          // Drop legacy docs whose createdAt is an ISO STRING (the old
          // seller-room write). Firestore's DESC index sorts strings ahead of
          // every Timestamp, so they'd permanently occupy the head of this
          // capped window AND render at the visual bottom as if newest —
          // starving live messages out. They carry no usable order; hide them.
          // (createdAt === null is KEPT: that's the latency-compensated local
          // state of a message this device just sent.)
          .filter((d) => typeof d.data()?.createdAt !== 'string')
          .map((d) => toChatDoc(d.id, d.data()))
          .reverse()
      );
    },
    (err) => {
      console.warn('[chat] listener error:', (err as any)?.message);
      onError?.(err);
    }
  );
}

/** Persist a message; requires a signed-in user (enforced by firestore.rules). */
export async function sendMessage(
  showId: string,
  payload: { user: string; text: string; avatar?: string; isBid?: boolean }
) {
  const u = auth.currentUser;
  if (!u) throw new Error('Sign in to send messages');

  // Belt and braces for the server's chat rules: firestore.rules now caps
  // text at 500 chars and user at 60. An over-length write isn't rejected
  // loudly — it's silently denied and just reads as a failed send — so clamp
  // client-side to the same limits before writing.
  const user = payload.user.slice(0, 60);
  const text = payload.text.slice(0, 500);

  await addDoc(collection(db, 'shows', showId, 'chat'), {
    uid: u.uid,
    user,
    text,
    avatar: payload.avatar ?? user.slice(0, 2).toUpperCase(),
    isBid: !!payload.isBid,
    createdAt: serverTimestamp(),
    // Firestore TTL field the backend is enabling: chat is ephemeral room
    // colour, so messages delete themselves after 30 days instead of
    // accumulating forever. The client clock is fine for a 30-day horizon.
    expireAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
  });
}
