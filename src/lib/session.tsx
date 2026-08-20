// src/lib/session.tsx — auth session state for route guarding (expo-router
// Stack.Protected pattern). Firebase persists the session in AsyncStorage, so
// onAuthStateChanged fires with the restored user on cold start.
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { router } from 'expo-router';
import { onAuthStateChanged, type User } from 'firebase/auth';

import {
  connect as connectAuctionEngine,
  disconnect as disconnectAuctionEngine,
} from './auction-socket';
import { auth } from './firebase';
import { ensureUserProfile, hasClaimedUsername } from './users';

const AuthContext = createContext<{
  user: User | null;
  isLoading: boolean;
} | null>(null);

export function useSession() {
  const value = use(AuthContext);
  if (!value) throw new Error('useSession must be wrapped in <SessionProvider>');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // One handle check per app session: social accounts created before the
  // claim-username step exist with no handle at all, and this is the only
  // surface every such account passes through.
  const promptedClaimFor = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      // Unverified accounts are treated as signed out — login() already
      // blocks them, but a stale persisted session could otherwise slip past
      // the guard.
      setUser(u && u.emailVerified ? u : null);
      setIsLoading(false);

      // Open the auction-engine socket the moment we know who this is —
      // NOT when a live room first mounts. The socket takes a moment to
      // connect and authenticate, and a bid placed before it was ready fell
      // back to the ~1s HTTP path: the FIRST bid in a room, the one that
      // most needs to feel instant, was reliably the slowest. connect() is a
      // no-op without an engine URL and never throws.
      if (u && u.emailVerified) {
        connectAuctionEngine().catch(() => {});
        // Publish/refresh publicProfiles/{uid} (fire-and-forget) — exactly
        // what the website does on auth ready. Without it a mobile-first
        // user is invisible to profiles, follows and DMs on both clients.
        ensureUserProfile().catch(() => {});
        // Backfill for social accounts created BEFORE the claim-username
        // step existed: they have no handle, so they're unfindable and
        // their deep links can't resolve. Once per account per app session,
        // and deferred a beat so it never races initial navigation.
        if (promptedClaimFor.current !== u.uid) {
          promptedClaimFor.current = u.uid;
          hasClaimedUsername()
            .then((claimed) => {
              if (!claimed) setTimeout(() => router.push('/claim-username'), 400);
            })
            .catch(() => {});
        }
      }
      // Sign-out ends it: the socket carries this user's identity and must
      // not survive into whoever signs in next on this device.
      else disconnectAuctionEngine();
    });
    return unsubscribe;
  }, []);

  return <AuthContext value={{ user, isLoading }}>{children}</AuthContext>;
}
