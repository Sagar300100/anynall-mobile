// src/lib/conversations.ts — mobile port of the web app's
// src/services/conversations.ts + src/services/messages.ts (the current 1:1
// messaging model). Same Firestore schema and the same participant-scoped
// security rules; message bodies are plaintext-at-rest by design (the rules
// are the boundary — see the web service's security notes).
//
//   conversations/{conversationId}
//     participantIds: [uidA, uidB] (sorted), participantMap: {uid:true},
//     participantMeta: {uid: {displayName, username, photoURL}},
//     lastMessageText/SenderId/At, unreadCounts, createdAt, updatedAt
//   conversations/{id}/messages/{msgId}
//     { conversationId, senderId, text, type:"text", createdAt }
import {
  addDoc,
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import { auth, db } from './firebase';

export interface ConversationView {
  id: string;
  otherUid: string;
  otherName: string;
  otherUsername: string;
  otherPhoto: string;
  lastMessageText: string;
  lastMessageAt?: number; // millis
  lastMessageSenderId: string;
  unread: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt?: number; // millis
}

export const MAX_MESSAGE_LEN = 2000;
const SEND_COOLDOWN_MS = 400;

/** Deterministic 1:1 conversation id — sorted uids joined by "_". */
export function directConversationId(a: string, b: string): string {
  return [a, b].sort().join('_');
}

/** Get (or create on first use) the 1:1 conversation with `otherUid`. */
export async function getOrCreateDirectConversation(
  otherUid: string,
  otherMeta?: { displayName?: string; username?: string; photoURL?: string }
): Promise<string> {
  const me = auth.currentUser;
  if (!me) throw new Error('Sign in to start a conversation.');
  if (!otherUid) throw new Error('Invalid user.');
  if (me.uid === otherUid) throw new Error("You can't message yourself.");

  const id = directConversationId(me.uid, otherUid);
  const ref = doc(db, 'conversations', id);
  const snap = await getDoc(ref);
  if (snap.exists()) return id;

  await setDoc(ref, {
    id,
    type: 'direct',
    participantIds: [me.uid, otherUid].sort(),
    participantMap: { [me.uid]: true, [otherUid]: true },
    participantMeta: {
      [me.uid]: {
        displayName: me.displayName || 'You',
        username: '',
        photoURL: me.photoURL || '',
      },
      [otherUid]: {
        displayName: otherMeta?.displayName || 'User',
        username: otherMeta?.username || '',
        photoURL: otherMeta?.photoURL || '',
      },
    },
    lastMessageText: '',
    lastMessageSenderId: '',
    lastMessageAt: serverTimestamp(),
    unreadCounts: { [me.uid]: 0, [otherUid]: 0 },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

/** Real-time list of the signed-in user's conversations, newest first. */
export function subscribeMyConversations(
  onChange: (list: ConversationView[]) => void,
  onError?: (message: string) => void
): () => void {
  const me = auth.currentUser;
  if (!me) {
    onChange([]);
    return () => {};
  }

  const q = query(
    collection(db, 'conversations'),
    where('participantIds', 'array-contains', me.uid),
    orderBy('lastMessageAt', 'desc')
  );

  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs.map((d) => {
          const c = d.data() as any;
          const otherUid = (c.participantIds || []).find((x: string) => x !== me.uid) || '';
          const meta = (c.participantMeta || {})[otherUid] || {};
          return {
            id: d.id,
            otherUid,
            otherName: meta.displayName || meta.username || 'User',
            otherUsername: meta.username || '',
            otherPhoto: meta.photoURL || '',
            lastMessageText: c.lastMessageText || '',
            lastMessageAt: c.lastMessageAt?.toMillis?.() ?? undefined,
            lastMessageSenderId: c.lastMessageSenderId || '',
            unread: (c.unreadCounts || {})[me.uid] || 0,
          };
        })
      );
    },
    (err) => {
      // Never swallow listener failures — an index/rules rejection otherwise
      // renders as "my messages disappeared".
      onChange([]);
      onError?.(err?.message || "Couldn't load your conversations.");
    }
  );
}

/** Reset the current user's unread counter for a conversation (on open). */
export async function markConversationRead(conversationId: string): Promise<void> {
  const me = auth.currentUser;
  if (!me || !conversationId) return;
  await updateDoc(doc(db, 'conversations', conversationId), {
    [`unreadCounts.${me.uid}`]: 0,
  }).catch(() => {});
}

/** Realtime subscription to a conversation's messages, oldest first. */
export function subscribeThreadMessages(
  conversationId: string,
  onChange: (msgs: ChatMessage[]) => void,
  onError?: (message: string) => void
): () => void {
  if (!conversationId) {
    onChange([]);
    return () => {};
  }
  const q = query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        snap.docs.map((d) => {
          const m = d.data() as any;
          return {
            id: d.id,
            senderId: m.senderId || '',
            text: m.text || '',
            createdAt: m.createdAt?.toMillis?.() ?? undefined,
          };
        })
      );
    },
    (err) => {
      onChange([]);
      onError?.(err?.message || "Couldn't load messages.");
    }
  );
}

let lastSendAt = 0;

/** Send a text message, then update the conversation summary + other side's
 *  unread counter — identical to the web client. */
export async function sendThreadMessage(
  conversationId: string,
  otherUid: string,
  rawText: string
): Promise<void> {
  const me = auth.currentUser;
  if (!me) throw new Error('Sign in to send messages.');
  if (!conversationId) throw new Error('No conversation selected.');

  const text = (rawText || '').trim();
  if (!text) return;
  if (text.length > MAX_MESSAGE_LEN) {
    throw new Error(`Message is too long (max ${MAX_MESSAGE_LEN} characters).`);
  }

  const now = Date.now();
  if (now - lastSendAt < SEND_COOLDOWN_MS) throw new Error('Slow down a moment.');
  lastSendAt = now;

  await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
    conversationId,
    senderId: me.uid,
    text,
    type: 'text',
    createdAt: serverTimestamp(),
  });

  const update: any = {
    lastMessageText: text.slice(0, 200),
    lastMessageSenderId: me.uid,
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (otherUid) update[`unreadCounts.${otherUid}`] = increment(1);
  await updateDoc(doc(db, 'conversations', conversationId), update).catch(() => {
    /* message already delivered; summary update failing is non-fatal */
  });
}
