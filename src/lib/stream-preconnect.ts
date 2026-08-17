// Speculative warm-up for the Live tab.
//
// All actual join mechanics live in stream-join.ts — ONE manager owns every
// viewer connection, whether it started from a tap or from this warm-up.
// This module only decides WHEN a speculative join is worth starting:
//
//   • ONE show at a time (the first live one), never the whole feed.
//   • Wi-Fi only — a warm room is a live video subscription, and spending a
//     buyer's mobile data on a show they may never open is not a trade to
//     make on a cellular plan. On cellular the TOKEN alone is prefetched
//     (about a kilobyte), which still removes a round trip from the join.
//   • Self-cancelling: stream-join drops any join that isn't adopted within
//     its idle window, so a buyer who scrolls past holds nothing.
import NetInfo from '@react-native-community/netinfo';

import { prefetchViewerToken } from './stream';
import { startJoin } from './stream-join';

/** Warm a show. Safe to call repeatedly; startJoin() is idempotent per show. */
export async function preconnectShow(showId: string, displayName?: string): Promise<void> {
  if (!showId) return;

  const net = await NetInfo.fetch();
  if (net.type !== 'wifi') {
    prefetchViewerToken(showId, displayName);
    return;
  }

  startJoin(showId, displayName);
}
