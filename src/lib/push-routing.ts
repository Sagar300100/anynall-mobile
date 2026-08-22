// src/lib/push-routing.ts — notification presentation + tap routing (Gap 1).
//
// One module owns BOTH global notification concerns:
// - the single foreground handler (expo-notifications keeps exactly one; a
//   later setNotificationHandler call replaces the earlier one, which is why
//   reminders.ts no longer sets its own — the per-notification logic lives
//   here instead),
// - routing a tapped notification to its screen by `data.type`, per the Gap 1
//   contract in docs/marketplace-gaps-spec.md.
//
// Imported by app/_layout.tsx: the import itself installs the handler at
// boot (earliest point that runs on every entry), and usePushRouting() is
// mounted once in the root navigator.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import type { GatedAction } from './auth-gate';
import { auth } from './firebase';

// Foreground presentation: always show the banner — a go-live alert that
// silently vanishes because the app happened to be open is a missed show —
// but remote pushes make NO sound while the user is in the app. Local show
// reminders (data.showId with no data.type — see lib/reminders.ts) keep
// their sound: they're alarms the user explicitly asked for.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Record<string, unknown> | null;
      const isRemotePush = typeof data?.type === 'string';
      return {
        // SDK 57: shouldShowAlert is deprecated — banner + list replace it.
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: !isRemotePush,
        shouldSetBadge: false,
      };
    },
  });
}

/** A routed target plus the gate reason shown if a GUEST taps into it —
 *  every notification target below needs an account, so the reason is
 *  always present. */
type NotificationRoute = { path: string; gate: GatedAction };

/** Where a tapped notification goes, by `data.type` (spec, Gap 1). Unknown or
 *  typeless data safely degrades to just opening the app. */
function routeForNotification(
  data: Record<string, unknown> | null | undefined
): NotificationRoute | null {
  const type = typeof data?.type === 'string' ? data.type : null;
  const showId = data?.showId != null ? String(data.showId) : '';
  const orderId = data?.orderId != null ? String(data.orderId) : '';
  switch (type) {
    case 'go_live':
    case 'auction_won':
      // auction_won also carries auctionId; the live room itself resolves the
      // winner payment sheet, so the show route covers both types.
      return showId ? { path: `/live/${showId}`, gate: 'watch' } : null;
    case 'offer_accepted':
      // The acceptance created a pending order the BUYER must now pay — the
      // buyer order screen carries the Pay-now flow. The backend sends
      // orderId (offersRouter accept push); without it, open-app is the floor.
      return orderId ? { path: `/order/${orderId}`, gate: 'orders' } : null;
    case 'order_delivered':
      // Buyer: the 24h protection window + unboxing recorder live here.
      return orderId ? { path: `/order/${orderId}`, gate: 'orders' } : null;
    case 'order_disputed':
      // Sent to the SELLER only (complaint push) — their dispute banner and
      // resolve actions live on the selling screen. The buyer order screen
      // can't even load someone else's order, so routing there dead-ends.
      return { path: '/seller-orders', gate: 'sell' };
    case 'payout_released':
      return { path: '/seller-orders', gate: 'sell' };
    case null:
      // Not a server push — a tapped LOCAL show reminder (lib/reminders.ts)
      // carries only { showId }. Land on the show page, ready to join.
      return showId ? { path: `/show/${showId}`, gate: 'watch' } : null;
    default:
      // A type this app version doesn't know (newer backend): opening the
      // app is the safe floor — never guess a screen.
      return null;
  }
}

// ── Session mirror (module scope — no hooks here) ───────────────────────────
// Every notification target above requires an account, so routing must know
// who this is. Mirrors session.tsx's rule (unverified counts as signed out).
// `resolved` matters: on a cold start Firebase restores the session async, and
// treating "not restored yet" as guest would bounce a signed-in member to the
// auth screen — so routing WAITS for the first auth event instead.
let sessionResolved = false;
let sessionUser: User | null = null;
const sessionWaiters: ((user: User | null) => void)[] = [];
if (Platform.OS !== 'web') {
  onAuthStateChanged(auth, (u) => {
    sessionUser = u && u.emailVerified ? u : null;
    sessionResolved = true;
    while (sessionWaiters.length) sessionWaiters.shift()?.(sessionUser);
  });
}
function withSession(cb: (user: User | null) => void) {
  if (sessionResolved) cb(sessionUser);
  else sessionWaiters.push(cb);
}

// A cold-start tap can be reported BOTH by getLastNotificationResponseAsync
// and (on some Android paths) by the response listener — route it exactly once.
let lastHandledResponseId: string | null = null;

function routeResponse(response: Notifications.NotificationResponse, delayMs: number) {
  const id = response.notification.request.identifier;
  if (id && id === lastHandledResponseId) return;
  lastHandledResponseId = id;
  const route = routeForNotification(
    response.notification.request.content.data as Record<string, unknown> | null
  );
  if (!route) return;
  // Deferred, never synchronous inside the effect/listener (repo rule), and
  // the cold-start tap needs the navigator settled before it can be routed —
  // same defer idiom as session.tsx's claim-username push. The session check
  // sits INSIDE the defer: by then the cold-start restore has usually
  // resolved, and if not, withSession waits for it rather than guessing.
  setTimeout(() => {
    withSession((user) => {
      try {
        if (user) router.push(route.path as never);
        // Guest (e.g. signed out after setting a reminder): the target needs
        // an account — sign-in with the reason, never a screen that bounces.
        else router.push({ pathname: '/sign-in', params: { reason: route.gate } } as never);
      } catch {
        // Navigator not ready / route rejected — the app being open is an
        // acceptable floor for a notification tap.
      }
    });
  }, delayMs);
}

/** Mounted once in the root layout: routes every notification tap, including
 *  the one that LAUNCHED the app (cold start). */
export function usePushRouting() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      routeResponse(response, 0);
    });
    // Cold start: the tap happened before this listener existed. The response
    // survives via getLastNotificationResponseAsync; routing waits out the
    // initial navigation (same 400ms beat session.tsx uses).
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) routeResponse(response, 400);
      })
      .catch(() => {});
    return () => sub.remove();
  }, []);
}
