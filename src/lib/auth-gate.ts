// src/lib/auth-gate.ts — per-action authentication gating.
//
// The app is browsable signed-out: the tab group is public and Firestore
// grants public read on shows/products/auctions. Auth is therefore never a
// wall around the app — it's requested at the moment a specific action needs
// an account, with a reason the user can act on.
//
// Usage:
//   const requireAuth = useAuthGate();
//   requireAuth('bid', () => placeBid(...));
import { router } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { useSession } from './session';

/** Actions that need an account. Each maps to copy shown on the auth screen. */
export type GatedAction =
  | 'bid'
  | 'buy'
  | 'chat'
  | 'favourite'
  | 'follow'
  | 'remind'
  | 'inbox'
  | 'orders'
  | 'sell'
  | 'profile'
  // Guest-flow gates (spec §6.2): home is browsable signed-out, everything
  // beyond it asks for an account first.
  | 'watch'
  | 'search'
  | 'browse'
  | 'notifications';

/** Second person, specific, and honest about why the account is needed. */
export const GATE_REASON: Record<GatedAction, string> = {
  bid: 'Sign in to place a bid — winning bids are a purchase commitment, so we need an account behind them.',
  buy: 'Sign in to buy — we need an account to hold your order and delivery details.',
  chat: 'Sign in to join the chat so sellers know who they’re talking to.',
  favourite: 'Sign in to save shows to your favourites and find them later.',
  follow: 'Sign in to follow sellers and hear when they go live.',
  remind: 'Sign in to get a reminder before this show starts.',
  inbox: 'Sign in to read your messages from sellers.',
  orders: 'Sign in to see your orders and track deliveries.',
  sell: 'Sign in to start selling on Any&All.',
  profile: 'Sign in to manage your account.',
  watch: 'Sign in to join live shows — bidding, buying and chat all happen inside the room.',
  search: 'Sign in to search live shows, products and sellers.',
  browse: 'Sign in to explore categories and the full catalog.',
  notifications: 'Sign in to see your notifications.',
};

/**
 * Returns `requireAuth(action, run)`.
 * Signed in → runs `run()` immediately.
 * Signed out → opens sign-in with the reason; the auth screen returns the user
 * to this exact screen on success (see useReturnAfterAuth), so the action is a
 * single tap away rather than lost.
 */
export function useAuthGate() {
  const { user } = useSession();

  return useCallback(
    (action: GatedAction, run: () => void) => {
      if (user) {
        run();
        return;
      }
      router.push({ pathname: '/sign-in', params: { reason: action } });
    },
    [user]
  );
}

/**
 * Call from an auth screen. Once the session resolves to a signed-in user it
 * pops the auth screen, returning the user to whatever they were doing — the
 * intent is preserved by the navigation stack itself rather than replayed.
 *
 * (Previously a root-level guard swapped stacks on sign-in. With the app
 * browsable signed-out there is no such guard, so the auth screens dismiss
 * themselves.)
 */
export function useReturnAfterAuth() {
  const { user } = useSession();
  useEffect(() => {
    if (!user) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [user]);
}

/**
 * The three session states screens must distinguish. Firebase restores the
 * persisted session asynchronously on cold start, so `user === null` alone
 * does NOT mean signed out — while `isLoading` is true the outcome is simply
 * unknown, and screens must show a neutral loading state, never the guest UI.
 */
export type AuthStatus = 'loading' | 'member' | 'guest';

export function useAuthStatus(): AuthStatus {
  const { user, isLoading } = useSession();
  if (user) return 'member';
  return isLoading ? 'loading' : 'guest';
}

/** True only once the session has RESOLVED to signed-out — never during restore. */
export function useIsGuest(): boolean {
  return useAuthStatus() === 'guest';
}
