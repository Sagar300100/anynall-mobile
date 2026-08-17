// Server-corrected clock.
//
// Auction fairness depends on everyone counting down to the SAME instant.
// `endsAt` is a server timestamp, but the countdown was computed against the
// device's own `Date.now()` — so a phone whose clock is a few seconds fast or
// slow showed the wrong time remaining. The server still enforces correctly
// (placeBid re-checks the server clock inside a transaction, so nobody can win
// a closed lot), but the buyer saw a number they could not trust, which for
// Sudden Death is the difference between bidding and not bothering.
//
// No extra endpoint or round trip: every HTTP response already carries a
// `Date` header. We sample it on API calls we were making anyway.
//
// Accuracy: the header has 1-second resolution, and we correct for half the
// round trip. Good to roughly ±500ms, which is what a one-second countdown
// needs. Anything tighter would need a real time-sync endpoint.

let offsetMs = 0;
let synced = false;
/** Round trip of the sample we trusted — a faster sample is a better sample. */
let bestRtt = Number.POSITIVE_INFINITY;

/** Feed an HTTP `Date` header. Keeps whichever sample had the lowest RTT. */
export function noteServerDate(dateHeader: string | null, rttMs: number): void {
  if (!dateHeader || !Number.isFinite(rttMs)) return;
  const serverSent = Date.parse(dateHeader);
  if (!Number.isFinite(serverSent)) return;
  // A slow request tells us less about "now" than a fast one, so only take a
  // sample that beats the best we have (with a little slack so a long-lived
  // session eventually re-syncs after the app sleeps).
  if (synced && rttMs > bestRtt * 1.5) return;

  // The header was stamped when the server began responding, so by the time it
  // reached us roughly half the round trip has passed.
  const estimatedServerNow = serverSent + rttMs / 2;
  offsetMs = estimatedServerNow - Date.now();
  bestRtt = rttMs;
  synced = true;
}

/** "Now" on the server's clock. Falls back to the device clock until synced. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Milliseconds until a server-issued ISO timestamp, on the server's clock. */
export function msUntil(iso?: string | null): number {
  if (!iso) return 0;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, at - serverNow());
}

/** How far this device's clock is from the server's. Diagnostics only. */
export function clockOffsetMs(): number {
  return offsetMs;
}

export function isClockSynced(): boolean {
  return synced;
}
