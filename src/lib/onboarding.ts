// First-run buyer setup: interest categories + a delivery address.
//
// Both exist to stop a buyer discovering problems late — an empty feed, or
// the interstate block that only appears the moment they try to bid.
//
// Storage is split because the two fields have different trust levels:
//   • interests → POST /api/profile/interests (users/{uid} is client-write
//     locked because it holds KYC/PII, so the server writes it)
//   • address   → POST /api/commerce/profile (the same saved address the
//     bid and Buy Now paths already read)
// Reading is direct: firestore.rules grants owner-read on users/{uid}.
import { doc, getDoc } from 'firebase/firestore';

import { j } from './api';
import { auth, db } from './firebase';

/** The ONLY values the server accepts (profileRouter's ALLOWED_INTERESTS).
 *  Anything else is silently filtered out server-side, so this list must stay
 *  in step with it — it is deliberately shorter than the full browse
 *  taxonomy. */
export const INTEREST_CATEGORIES = [
  'Sneakers & Streetwear',
  "Women's Fashion",
  'Watches',
  'Heritage',
  'Electronics',
  'Collectibles',
  'Beauty',
  'Home',
] as const;

export interface OnboardingState {
  interestsCompleted: boolean;
  interests: string[];
  hasAddress: boolean;
}

/** Null when signed out or unreadable — callers should not prompt in that case. */
export async function getOnboardingState(): Promise<OnboardingState | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const d = snap.data() || {};
    return {
      interestsCompleted: d.interestsCompleted === true,
      interests: Array.isArray(d.interests) ? d.interests.map(String) : [],
      hasAddress: !!d.commerce?.savedAddress?.stateCode,
    };
  } catch {
    return null;
  }
}

/** Save picks. `skip: true` records the decline so we stop asking. */
export function saveInterests(interests: string[]) {
  return j<{ ok: boolean; interestsCompleted: boolean }>(
    '/api/profile/interests',
    { method: 'POST', body: JSON.stringify({ interests }) },
    true
  );
}

export function skipInterests() {
  return j<{ ok: boolean }>(
    '/api/profile/interests',
    { method: 'POST', body: JSON.stringify({ skip: true, interests: [] }) },
    true
  );
}
