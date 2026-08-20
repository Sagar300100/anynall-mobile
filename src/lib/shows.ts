// src/lib/shows.ts — mobile port of the web app's services/showsfirestore.ts.
// Shows live in the `shows` Firestore collection (public read per
// firestore.rules); the deployed HTTP API has no /api/shows route, so this is
// the same source of truth the website uses.
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import type { ShowData } from './api';
import type { SellingFormat } from './category-tree';
import { auth, db } from './firebase';
import { getSellerOnboarding } from './seller';

function toUI(id: string, d: any): ShowData {
  const when = d?.scheduled_time ? new Date(d.scheduled_time) : null;

  return {
    id,
    name: d?.title ?? d?.name ?? 'Untitled Show',
    date: when ? when.toISOString().slice(0, 10) : 'TBD',
    time: when ? when.toTimeString().slice(0, 5) : 'TBD',
    category: d?.category ?? 'Uncategorized',
    subcategory: d?.subcategory ?? '',
    // `sellingFormat` is what every reader (web + mobile) uses; older docs
    // from this app's scheduler only carried `primarySellingFormat`.
    sellingFormat: d?.sellingFormat ?? d?.primarySellingFormat ?? 'Auction',
    brand: d?.brand ?? 'N/A',
    shippedFrom: d?.shippedFrom ?? 'N/A',
    sellerRating: typeof d?.sellerRating === 'number' ? d.sellerRating : null,
    tags: Array.isArray(d?.tags) ? d.tags : [],
    isLive: !!d?.isLive,
    thumbnail: d?.thumbnail_url ?? d?.thumbnail ?? '',
    // Store handle stamped at create time is the truth. Older shows predate
    // that stamp and have nothing readable (sellerOnboarding is owner-read
    // only), so they resolve via publicProfiles — see resolveSellerNames().
    // "Anonymous" was actively misleading: these are real, named stores.
    seller:
      d?.sellerUsername ??
      d?.seller?.username ??
      (typeof d?.seller === 'string' ? d.seller : ''),
    sellerName: d?.sellerName ?? '',
    title: d?.title,
    thumbnail_url: d?.thumbnail_url,
    scheduled_time: d?.scheduled_time ?? null,
    sellerId: d?.sellerId ?? undefined,
    sellerObj: d?.sellerObj ?? null,
    ownerUid: d?.ownerUid ?? null,
    replayUrl: d?.replay_url ?? null,
  };
}

/** Newest 60 shows. This used to fetch the ENTIRE shows collection on every
 *  Live-tab load — the whole list had to arrive before a single card could
 *  render, which got slower with every show ever created. 60 comfortably
 *  covers the live grid, the upcoming list and the browse rails. */
export async function fsFetchShows(): Promise<ShowData[]> {
  const q = query(collection(db, 'shows'), orderBy('scheduled_time', 'desc'), limit(60));
  const snap = await getDocs(q);
  return resolveSellerNames(snap.docs.map((d) => toUI(d.id, d.data())));
}

/** Fills in seller names for shows created before the identity stamp.
 *
 *  Those docs carry only `ownerUid`, and a buyer cannot read another user's
 *  sellerOnboarding — so the display name comes from `publicProfiles/{uid}`,
 *  which firestore.rules makes world-readable precisely for this (it holds
 *  only non-sensitive social fields).
 *
 *  One read per DISTINCT missing seller, not per show, and only for shows
 *  that actually lack a name. Failures leave the show unnamed rather than
 *  inventing one. */
async function resolveSellerNames(shows: ShowData[]): Promise<ShowData[]> {
  const missing = [
    ...new Set(shows.filter((s) => !s.seller && s.ownerUid).map((s) => s.ownerUid as string)),
  ];
  if (missing.length === 0) return shows;

  const found = new Map<string, { handle: string; name: string }>();
  await Promise.all(
    missing.map(async (uid) => {
      try {
        const p = await getDoc(doc(db, 'publicProfiles', uid));
        if (!p.exists()) return;
        const d = p.data();
        const handle = String(d.username || '');
        const name = String(d.displayName || '');
        if (handle || name) found.set(uid, { handle, name });
      } catch {
        /* leave unnamed — never guess */
      }
    })
  );

  if (found.size === 0) return shows;
  return shows.map((s) => {
    if (s.seller || !s.ownerUid) return s;
    const hit = found.get(s.ownerUid);
    if (!hit) return s;
    return { ...s, seller: hit.handle || hit.name, sellerName: hit.name || s.sellerName };
  });
}

// ── Scheduling ─────────────────────────────────────────────────────────────
// There is no server endpoint that creates shows: streamRouter only issues
// join tokens and ends broadcasts. Shows are written straight to Firestore,
// gated by firestore.rules, which requires ownerUid === auth.uid AND
// users/{uid}.isSeller === true. That rule — not this function — is what
// enforces "only an approved seller may schedule".

export type Discoverability = 'public' | 'private';

export interface NewShow {
  title: string;
  /** Absolute instant. Stored ISO-8601 with offset so the seller's timezone
   *  survives; the app renders it back in the device's local zone. */
  scheduledAt: Date;
  category: string;
  /** How the show mainly sells — auction / buy-it-now / surprise-sets. */
  sellingFormat: SellingFormat;
  language: string;
  discoverability: Discoverability;
  explicitContent: boolean;
  mutedWords: string[];
  thumbnailUrl?: string | null;
  /** Discovery fields — same names the web scheduler writes. All optional. */
  subcategory?: string;
  brand?: string;
  tags?: string[];
}

/** Creates the show and returns its real Firestore id.
 *
 *  The seller's STORE identity is stamped onto the doc at write time. It has
 *  to be: a buyer cannot look it up. Store name and handle live in
 *  users/{uid}.sellerOnboarding, and firestore.rules grants owner-read only on
 *  users/* (it holds KYC/PII) — so without this stamp every buyer surface fell
 *  back to "Anonymous". */
export async function createShow(p: NewShow): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('NOT_SIGNED_IN');

  // Best-effort: a profile hiccup must not stop a seller scheduling a show.
  let sellerName = '';
  let sellerUsername = '';
  try {
    const s = await getSellerOnboarding();
    sellerName = s.storeName || '';
    sellerUsername = s.storeHandle || '';
  } catch {
    /* falls back to the public-profile resolver on the buyer side */
  }

  const ref = await addDoc(collection(db, 'shows'), {
    ownerUid: uid,
    sellerName,
    sellerUsername,
    title: p.title,
    // `scheduled_time` is the field every existing reader already uses.
    scheduled_time: p.scheduledAt.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    category: p.category,
    // BOTH spellings: every reader on both clients reads `sellingFormat`, but
    // shows written by earlier builds of this app only carried
    // `primarySellingFormat` — writing both keeps every reader correct.
    sellingFormat: p.sellingFormat,
    primarySellingFormat: p.sellingFormat,
    subcategory: p.subcategory || '',
    brand: p.brand || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    thumbnail_url: p.thumbnailUrl || null,
    language: p.language,
    discoverability: p.discoverability,
    explicitContent: p.explicitContent,
    // Chat filter list — seller-configured, not shown to buyers.
    mutedWords: p.mutedWords,
    isLive: false,
    status: 'scheduled',
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** The signed-in seller's own shows that still need them: anything scheduled
 *  ahead, PLUS anything currently live.
 *
 *  Live shows used to be excluded (`!s.isLive`), which stranded the seller:
 *  the moment they went live the show vanished from the hub, and the Live tab
 *  only opens the BUYER view — so there was no way back into their own show
 *  room to start a lot or end the broadcast. Live shows now sort first. */
export async function fetchMyUpcomingShows(): Promise<ShowData[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const snap = await getDocs(query(collection(db, 'shows'), where('ownerUid', '==', uid)));
  const nowIso = new Date().toISOString();
  return snap.docs
    .map((d) => toUI(d.id, d.data()))
    .filter((s) => s.isLive || (s.scheduled_time ?? '') >= nowIso)
    .sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
    });
}

/** Cancels (deletes) a scheduled show. firestore.rules allows delete only
 *  when resource.data.ownerUid === auth.uid, so a seller can only ever remove
 *  their own. */
export async function deleteShow(id: string): Promise<void> {
  await deleteDoc(doc(db, 'shows', id));
}

// ── Editing ────────────────────────────────────────────────────────────────
// firestore.rules allows update only when resource.data.ownerUid ===
// auth.uid and ownerUid is unchanged, so these writes are owner-only by the
// same rule that guards create.

/** Everything the edit form needs to prefill itself. Null when the show is
 *  gone or unreadable. */
export interface ShowEditable {
  title: string;
  scheduledTimeIso: string | null;
  category: string;
  sellingFormat: SellingFormat;
  language: string;
  discoverability: Discoverability;
  explicitContent: boolean;
  mutedWords: string[];
  thumbnailUrl: string | null;
  sellerNotes: string;
  subcategory: string;
  brand: string;
  tags: string[];
}

export async function getShowEditable(id: string): Promise<ShowEditable | null> {
  const snap = await getDoc(doc(db, 'shows', id));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    title: String(d.title ?? ''),
    scheduledTimeIso: d.scheduled_time ? String(d.scheduled_time) : null,
    category: String(d.category ?? ''),
    sellingFormat: (d.sellingFormat ?? d.primarySellingFormat ?? 'buy-it-now') as SellingFormat,
    language: String(d.language ?? 'English'),
    discoverability: (d.discoverability ?? 'public') as Discoverability,
    explicitContent: d.explicitContent === true,
    mutedWords: Array.isArray(d.mutedWords) ? d.mutedWords.map(String) : [],
    thumbnailUrl: d.thumbnail_url ? String(d.thumbnail_url) : null,
    sellerNotes: String(d.sellerNotes ?? ''),
    subcategory: String(d.subcategory ?? ''),
    brand: String(d.brand ?? ''),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
  };
}

/** Applies the edit form's changes. ownerUid is never sent, so the rule that
 *  requires it to be unchanged can't be tripped. */
export async function updateShow(id: string, p: NewShow): Promise<void> {
  await updateDoc(doc(db, 'shows', id), {
    title: p.title,
    scheduled_time: p.scheduledAt.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    category: p.category,
    // Both spellings, same reason as createShow: readers use `sellingFormat`.
    sellingFormat: p.sellingFormat,
    primarySellingFormat: p.sellingFormat,
    subcategory: p.subcategory || '',
    brand: p.brand || '',
    tags: Array.isArray(p.tags) ? p.tags : [],
    thumbnail_url: p.thumbnailUrl || null,
    language: p.language,
    discoverability: p.discoverability,
    explicitContent: p.explicitContent,
    mutedWords: p.mutedWords,
    updatedAt: serverTimestamp(),
  });
}

// NOTE: there is deliberately no `setShowLive` here. Going live is SERVER
// owned — see lib/stream.ts. Writing `isLive` from the client marks the show
// live in the browse rails without creating the `liveRooms/{id}` gate that
// streamRouter requires, so every viewer's token request is then refused with
// SHOW_NOT_LIVE. Use getStreamToken(showId, 'host') / endStream(showId).

/** Self-healing backfill for shows created before the seller-identity stamp.
 *
 *  Only the OWNER can do this: reading store name/handle needs owner-read on
 *  users/{uid}, and writing the show needs the owner-only update rule. So the
 *  moment a seller opens their own show room, that show stops appearing
 *  unnamed to every buyer. No migration script, no admin credentials.
 *
 *  Silent and best-effort — it must never interrupt opening the room. */
export async function backfillSellerIdentity(
  showId: string,
  storeName?: string,
  storeHandle?: string
): Promise<void> {
  if (!showId || (!storeName && !storeHandle)) return;
  try {
    const snap = await getDoc(doc(db, 'shows', showId));
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.ownerUid !== auth.currentUser?.uid) return;
    if (d.sellerUsername || d.sellerName) return; // already stamped
    await updateDoc(doc(db, 'shows', showId), {
      sellerName: storeName || '',
      sellerUsername: storeHandle || '',
    });
  } catch {
    /* best-effort */
  }
}

/** The seller's other shows — the source list for Clone Items. Excludes the
 *  show being cloned into. */
export async function fetchMyOtherShows(exceptId: string): Promise<ShowData[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const snap = await getDocs(query(collection(db, 'shows'), where('ownerUid', '==', uid)));
  return snap.docs
    .filter((d) => d.id !== exceptId)
    .map((d) => toUI(d.id, d.data()))
    .sort((a, b) => (b.scheduled_time || '').localeCompare(a.scheduled_time || ''));
}
