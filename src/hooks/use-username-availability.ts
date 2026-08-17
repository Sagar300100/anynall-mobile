// Debounced username availability against the real backend — shared by
// sign-up and the post-social claim step. CHECK_FAILED stays neutral: the
// server-side atomic claim (Firestore transaction on usernames/{handle}) is
// the authority, never this check.
import { useEffect, useRef, useState } from 'react';

import { checkUsername } from '@/lib/api';

/** Exact mirror of the server rule (functions/profileRouter.js:80):
 *  lowercase, starts with a letter, then letters/digits/underscore, 3–20. */
export const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

export const USERNAME_HELPER = '3–20 characters • Starts with a letter • Letters, numbers, _';

export type Availability =
  | 'idle'
  | 'checking'
  | 'available'
  | 'taken'
  | 'reserved'
  | 'invalid'
  | 'unknown';

/** Specific message for a syntactically invalid handle. */
export function usernameProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.length < 3) return 'Too short — use at least 3 characters.';
  if (v.length > 20) return 'Too long — 20 characters maximum.';
  if (!/^[a-z]/.test(v)) return 'Must start with a letter.';
  if (!/^[a-z0-9_]+$/.test(v)) return 'Only letters, numbers and underscores.';
  return null;
}

/**
 * Availability for `username`, debounced. Stale responses are discarded: each
 * run claims a sequence number and only the newest may publish a result, so a
 * slow reply for an old value can never overwrite a newer one.
 */
export function useUsernameAvailability(username: string): Availability {
  const [availability, setAvailability] = useState<Availability>('idle');
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    const clean = username.trim();

    if (!clean) {
      setAvailability('idle');
      return;
    }
    if (!USERNAME_RE.test(clean)) {
      setAvailability('invalid');
      return;
    }

    setAvailability('checking');
    const timer = setTimeout(async () => {
      const res = await checkUsername(clean);
      if (seq !== seqRef.current) return; // a newer keystroke won
      if (res.available) setAvailability('available');
      else if (res.reason === 'CHECK_FAILED') setAvailability('unknown');
      else if (res.reason === 'RESERVED') setAvailability('reserved');
      else setAvailability('taken');
    }, 500);

    return () => clearTimeout(timer);
  }, [username]);

  return availability;
}

/**
 * Up to `count` alternatives for a taken handle, each **verified free against
 * the backend** before it's offered — we never suggest a name that's already
 * gone. Nothing is reserved; the user still confirms.
 */
export async function suggestAlternatives(base: string, count = 3): Promise<string[]> {
  const stem = base.trim().replace(/_+$/, '').slice(0, 15);
  if (!stem || !/^[a-z]/.test(stem)) return [];

  const candidates = Array.from(
    new Set([
      `${stem}1`,
      `${stem}_live`,
      `${stem}_in`,
      `${stem}${Math.floor(Math.random() * 90) + 10}`,
      `${stem}_shop`,
    ])
  ).filter((v) => USERNAME_RE.test(v));

  const checked = await Promise.all(
    candidates.map(async (v) => ((await checkUsername(v)).available ? v : null))
  );
  return checked.filter((v): v is string => !!v).slice(0, count);
}

/** Best-effort handle suggestion from a social display name. Never derived
 *  from email (handles are public), never auto-claimed — the user confirms. */
export function suggestUsername(displayName?: string | null): string {
  const base = (displayName || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    .slice(0, 20);
  if (!base || !/^[a-z]/.test(base) || base.length < 3) return '';
  return base;
}
