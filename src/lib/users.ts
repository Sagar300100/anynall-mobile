// src/lib/users.ts — mobile port of the website's src/services/users.ts:
// public, searchable user profiles.
//
// IMPORTANT: these live in `publicProfiles/{uid}`, NOT `users/{uid}`.
// `users/{uid}` is owner-read-only + server-write-only because it holds
// KYC/PII (Aadhaar/PAN status, encrypted bank ciphertext, isSeller…). Making
// it public-read — as a generic social schema would — would leak PII.
// `publicProfiles` contains ONLY non-sensitive social fields and is safe to
// expose for profiles/follows/DM. Same schema as the web client, so a profile
// published from either surface renders on both.
import {
  collection,
  doc,
  endAt,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAt,
} from 'firebase/firestore';

import { auth, db } from './firebase';

export interface PublicProfile {
  uid: string;
  displayName: string;
  username: string;
  usernameLower: string;
  photoURL: string;
  bio: string;
  /** Instagram-style privacy: private accounts require a follow request. */
  isPrivate: boolean;
  /** Mirrored from users/{uid} — drives the seller vs buyer profile layout. */
  isSeller: boolean;
  /** Interest categories (mirrored on save) — shown in About. */
  interests: string[];
  /** Account creation time in millis (for "Joined July 2026"). */
  createdAtMs?: number;
}

function toPublicProfile(uid: string, d: any): PublicProfile {
  return {
    uid,
    displayName: d?.displayName || d?.username || 'User',
    username: d?.username || '',
    usernameLower: d?.usernameLower || '',
    photoURL: d?.photoURL || '',
    bio: d?.bio || '',
    isPrivate: d?.isPrivate === true,
    isSeller: d?.isSeller === true,
    interests: Array.isArray(d?.interests)
      ? d.interests.filter((x: any) => typeof x === 'string')
      : [],
    createdAtMs: d?.createdAt?.toMillis?.() ?? undefined,
  };
}

/**
 * Ensure the signed-in user has a public profile (publicProfiles/{uid}).
 * Idempotent — called on every sign-in (see session.tsx), exactly as the web
 * app does from App.tsx. Without this, a mobile-first user would be invisible
 * to profile views, follows and DM search on both clients.
 */
export async function ensureUserProfile(): Promise<void> {
  const u = auth.currentUser;
  if (!u) return;

  let username = '';
  let bio = '';
  let isSeller = false;
  let interests: string[] = [];
  try {
    const snap = await getDoc(doc(db, 'users', u.uid)); // owner can read own
    if (snap.exists()) {
      const d = snap.data() as any;
      username = d.username || '';
      bio = d?.profile?.bio || '';
      isSeller = d.isSeller === true;
      if (Array.isArray(d.interests))
        interests = d.interests.filter((x: any) => typeof x === 'string');
    }
  } catch {
    /* owner read blocked — publish from auth data only */
  }

  const displayName = (
    u.displayName ||
    username ||
    (u.email ? u.email.split('@')[0] : 'User')
  ).trim();
  const ref = doc(db, 'publicProfiles', u.uid);
  const existing = await getDoc(ref).catch(() => null);

  const payload: any = {
    uid: u.uid,
    displayName,
    displayNameLower: displayName.toLowerCase(),
    username,
    usernameLower: username.toLowerCase(),
    photoURL: u.photoURL || '',
    bio,
    // Mirrored so OTHER users' clients can render the right profile layout
    // (users/{uid} itself is owner-read-only).
    isSeller,
    interests,
    // NOTE: deliberately NO `isPrivate` here — this merge must never clobber
    // a privacy choice made via setAccountPrivacy with a default.
    updatedAt: serverTimestamp(),
  };
  if (!existing || !existing.exists()) payload.createdAt = serverTimestamp();

  try {
    await setDoc(ref, payload, { merge: true });
  } catch {
    /* non-fatal — retried on next sign-in */
  }
}

/** Toggle Instagram-style account privacy on the caller's own public profile. */
export async function setAccountPrivacy(isPrivate: boolean): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error('Sign in first.');
  await setDoc(
    doc(db, 'publicProfiles', u.uid),
    { uid: u.uid, isPrivate, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/**
 * Does the signed-in account have a claimed @handle?
 *
 * Email sign-up claims one inside register(); the SOCIAL path (Google/Apple)
 * has no form, so it must be followed by the claim-username step. Reads the
 * RAW users/{uid} doc — never a seeded/derived profile, whose placeholder
 * would mask an unclaimed handle. Errors resolve true (fail open): a read
 * hiccup must not wall a signed-in user behind the claim screen.
 */
export async function hasClaimedUsername(): Promise<boolean> {
  const u = auth.currentUser;
  if (!u) return true;
  try {
    const snap = await getDoc(doc(db, 'users', u.uid));
    return !!(snap.exists() && (snap.data() as any).username);
  } catch {
    return true;
  }
}

/** Resolve a username/handle to its uid via the public usernames/{handle} map. */
export async function lookupUidByUsername(username: string): Promise<string | null> {
  const clean = (username || '').trim().toLowerCase();
  if (!clean) return null;
  try {
    const snap = await getDoc(doc(db, 'usernames', clean));
    if (!snap.exists()) return null;
    const d = snap.data() as any;
    return typeof d?.uid === 'string' ? d.uid : null;
  } catch {
    return null;
  }
}

export async function getPublicProfile(uid: string): Promise<PublicProfile | null> {
  try {
    const snap = await getDoc(doc(db, 'publicProfiles', uid));
    return snap.exists() ? toPublicProfile(uid, snap.data()) : null;
  } catch {
    return null;
  }
}

/**
 * Search users by username (prefix) and, best-effort, displayName (prefix) —
 * the same publicProfiles queries the website's Messages search runs.
 * Excludes the current user; requires >= 2 chars; de-duplicated.
 */
export async function searchUsers(qStr: string, max = 12): Promise<PublicProfile[]> {
  // Strip a leading "@" — people type "@name", handles are stored without it.
  const term = qStr.trim().toLowerCase().replace(/^@+/, '');
  if (term.length < 2) return [];
  const me = auth.currentUser?.uid;
  const col = collection(db, 'publicProfiles');
  const out = new Map<string, PublicProfile>();

  const run = async (field: 'usernameLower' | 'displayNameLower') => {
    try {
      // [term, term + \uf8ff] spans every string PREFIXED by the term. Written
      // as an escape, not a literal char — the invisible literal here was
      // repeatedly misread as endAt(term), i.e. an exact-match-only bug.
      const snap = await getDocs(
        query(col, orderBy(field), startAt(term), endAt(term + '\uf8ff'), limit(max))
      );
      snap.forEach((s) => {
        if (s.id === me) return; // never show the current user
        if (!out.has(s.id)) out.set(s.id, toPublicProfile(s.id, s.data()));
      });
    } catch {
      /* index building / no results — ignore */
    }
  };

  await run('usernameLower');
  if (out.size < max) await run('displayNameLower');

  return Array.from(out.values()).slice(0, max);
}
