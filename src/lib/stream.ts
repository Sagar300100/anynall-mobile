// LiveKit join tokens.
//
// The SERVER owns going live, not the client. Requesting a `host` token is
// what marks the show live: streamRouter sets `liveRooms/{showId}.live = true`
// and stamps `shows/{showId}.isLive = true` in the same call. Viewers are
// refused with SHOW_NOT_LIVE until that gate exists — which is why the app
// must never just write `isLive` itself: the show would look live in the
// browse rails while every viewer's token request got rejected.
//
// /end is the mirror image: it clears the gate and marks the show ended. It's
// idempotent, so it is safe from every teardown path.
import { j } from './api';
import { auth } from './firebase';

export type StreamRole = 'host' | 'viewer';

export interface StreamGrant {
  /** Signed JWT for the LiveKit room. Short-lived. */
  token: string;
  /** wss://<project>.livekit.cloud */
  url: string;
  /** LiveKit room name — `show_<showId>`, not the show id. */
  roomId: string;
  role: StreamRole;
  userId: string;
}

/** The auction engine's HTTPS origin, derived from the socket URL. The engine
 *  mints VIEWER tokens in a few milliseconds because it is always warm; the
 *  Cloud Functions monolith it replaces cold-started at 0.5–3s, and the token
 *  sits in front of every video join. Unset → the API path, as before. */
const ENGINE_HTTP = (process.env.EXPO_PUBLIC_AUCTION_ENGINE_URL || '').replace(/^ws/i, 'http');

/** How long the engine gets before the join falls back to the slower-but-sure
 *  API path. Generous relative to its ~100ms typical answer, tight relative to
 *  the multi-second monolith worst case it protects against. */
const ENGINE_TOKEN_TIMEOUT_MS = 2000;

/** Viewer tokens via the engine. Throws on ANY miss — wrong status, timeout,
 *  network — and the caller falls back. A SHOW_NOT_LIVE verdict is re-thrown
 *  in the same shape streamErrorMessage() already understands. */
async function engineViewerToken(showId: string, displayName?: string): Promise<StreamGrant> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!ENGINE_HTTP || !idToken) throw new Error('ENGINE_UNAVAILABLE');
  const res = await fetch(`${ENGINE_HTTP}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ showId, displayName }),
    signal: AbortSignal.timeout(ENGINE_TOKEN_TIMEOUT_MS),
  });
  if (res.status === 409) throw new Error('SHOW_NOT_LIVE'); // real verdict, not a miss
  if (!res.ok) throw new Error(`ENGINE_TOKEN_${res.status}`);
  return (await res.json()) as StreamGrant;
}

/** Host: marks the show live and returns a publish-capable token.
 *  Viewer: returns a subscribe-only token, or throws SHOW_NOT_LIVE.
 *  opts.heartbeat (host only) marks the liveRooms doc as heartbeat-capable —
 *  the backend's stale-room sweep then holds it to the tight (35 min)
 *  schedule instead of the conservative backstop meant for hosts (like the
 *  web studio) that never re-mint. */
export async function getStreamToken(
  showId: string,
  role: StreamRole,
  displayName?: string,
  opts?: { heartbeat?: boolean }
) {
  // Viewers try the always-warm engine first. SHOW_NOT_LIVE is an answer, not
  // a failure — it propagates. Anything else falls back to the API path, so a
  // down engine only ever costs the 2s timeout, never the join.
  if (role === 'viewer' && ENGINE_HTTP) {
    try {
      const grant = await engineViewerToken(showId, displayName);
      console.warn('[join] token via engine');
      return grant;
    } catch (err) {
      if (err instanceof Error && err.message === 'SHOW_NOT_LIVE') throw err;
      console.warn('[join] engine token miss — falling back to API');
    }
  }
  return j<StreamGrant>(
    '/api/stream/token',
    {
      method: 'POST',
      body: JSON.stringify({
        roomId: showId,
        role,
        displayName,
        ...(role === 'host' && opts?.heartbeat ? { heartbeat: true } : {}),
      }),
    },
    true
  );
}

// ── Join timing ────────────────────────────────────────────────────────────
// (A viewer-token prefetch cache used to live here; stream-join.ts's
// startJoin() — which begins the whole join, token AND connect, at tap time —
// superseded it. Only the tap markers below remain.)

/** When the buyer TAPPED a show card.
 *
 *  The only number that matters is tap → first frame, which is what a buyer
 *  experiences as "how long the stream takes to open". Every measurement here
 *  used to start at ViewerStage mount instead, so it excluded the tap handler,
 *  the navigation push and the screen transition — and reported ~100ms for a
 *  join the buyer felt as seconds. */
const tappedAt = new Map<string, number>();

export function markShowTapped(showId: string): void {
  if (showId) tappedAt.set(showId, Date.now());
}

/** ms since the tap for this show, or null if it wasn't opened by a tap. */
export function msSinceTap(showId: string): number | null {
  const at = tappedAt.get(showId);
  return at === undefined ? null : Date.now() - at;
}

/** Host-only. Closes the live gate and marks the show ended. */
export function endStream(showId: string) {
  return j<{ ok: boolean }>(
    '/api/stream/end',
    { method: 'POST', body: JSON.stringify({ roomId: showId }) },
    true
  );
}

/** Maps the server's error codes to something a seller or buyer can act on. */
export function streamErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/STREAM_NOT_CONFIGURED/.test(text)) return 'Streaming isn’t configured on the server yet.';
  if (/SHOW_NOT_LIVE/.test(text)) return 'This show isn’t live right now.';
  if (/NOT_SHOW_OWNER/.test(text)) return 'Only the show’s owner can broadcast.';
  if (/SHOW_NOT_FOUND/.test(text)) return 'That show no longer exists.';
  if (/STREAM_UPSTREAM_ERROR/.test(text)) return 'The streaming service didn’t respond. Try again.';
  const m = text.match(/"message"\s*:\s*"([^"]+)"/);
  return m?.[1] || 'Couldn’t connect to the stream.';
}
