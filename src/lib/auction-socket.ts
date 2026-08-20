// Client side of the auction engine.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: the socket is an accelerator, not
// a dependency. Every function here is safe to call when the engine is down,
// unreachable, or not deployed at all — `isReady()` returns false and the
// caller bids over HTTP exactly as it always has. A buyer must never be unable
// to bid because a performance optimisation is unhealthy.
//
// See ../../../AUCTION-ENGINE.md.
import { auth } from './firebase';
import { placeBid as placeBidHttp } from './commerce';

/** Unset in any build where the engine hasn't been deployed — which is the
 *  normal state until it has, and must stay harmless. */
const ENGINE_URL = process.env.EXPO_PUBLIC_AUCTION_ENGINE_URL || '';

/** Auction state as the engine broadcasts it. Mirrors registry.publicView(). */
export interface EngineAuction {
  id: string;
  showId: string | null;
  productId: string | null;
  status: string;
  startPrice: number;
  bidStep: number;
  currentBid: number;
  currentBidderUid: string | null;
  currentBidderName: string | null;
  bidCount: number;
  endsAt: string | null;
  suddenDeath: boolean;
  version: number;
}

export interface EngineError {
  code: string;
  message: string;
  auctionId?: string;
  minNext?: number;
}

type StateHandler = (auctions: EngineAuction[]) => void;
type BidHandler = (auction: EngineAuction) => void;
type ErrorHandler = (err: EngineError) => void;
/** The engine closed this auction — its frame carries only the id. */
type EndedHandler = (auctionId: string) => void;

interface Subscription {
  showId: string;
  onState: StateHandler;
  onBid: BidHandler;
  onError: ErrorHandler;
  onEnded?: EndedHandler;
}

let socket: WebSocket | null = null;
let authed = false;
/** Backoff so a dead engine is retried politely rather than hammered. */
let retryMs = 1000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const subs = new Map<string, Subscription>();
/** auctionId -> when this device last sent a bid, for round-trip timing. */
const inflight = new Map<string, number>();

/** auctionId -> the last bid this device sent over the socket, kept just long
 *  enough to replay it over HTTP if the engine rejects it with a STALE gate
 *  (see below). The idempotency key travels with it, so the replay can never
 *  double-bid. */
const lastBids = new Map<string, { amount: number; idem: string; at: number }>();

/** Rejection codes computed from the bidder context the engine cached at
 *  socket AUTH time. The engine loads that context once per connection, so a
 *  buyer who completes Get Ready (address + method + terms) MID-SESSION keeps
 *  getting rejected with the stale gate forever — the socket never re-reads
 *  the profile. The HTTP bid path re-checks everything fresh, so on any of
 *  these we (a) replay the bid over HTTP with the same idempotency key and
 *  (b) force a reconnect so the NEXT socket bid sees the fresh context. */
const STALE_CTX_CODES = new Set([
  'SETUP_REQUIRED',
  'AUCTION_TERMS_REQUIRED',
  'BID_BLOCKED_UNPAID',
  'NOT_ELIGIBLE',
  'INTERSTATE_BLOCKED',
  'DELIVERY_STATE_REQUIRED',
  // The engine's can-buy check fails CLOSED with this when its cached ID
  // token has expired (the socket lives for the whole session; tokens live an
  // hour) — the single most likely stale verdict, and the one whose entire
  // meaning is "the cached check could not run". The HTTP replay runs it
  // fresh; reauth() reconnects with a fresh token.
  'ELIGIBILITY_UNAVAILABLE',
  'SELLER_UNKNOWN',
  'SELLER_NOT_ACTIVE',
  'SELLER_STATE_UNKNOWN',
]);
/** Replay horizon: a gate error landing later than this can't be paired with
 *  the tap that caused it, so it is surfaced instead of replayed. */
const REPLAY_WINDOW_MS = 15_000;

function log(message: string) {
  console.warn(`[engine] ${message}`);
}

/** True only when a bid sent right now would actually reach the authority.
 *  Callers branch on this to decide socket vs HTTP. */
export function isReady(): boolean {
  return !!socket && socket.readyState === WebSocket.OPEN && authed;
}

function send(msg: Record<string, unknown>): boolean {
  if (!isReady()) return false;
  socket?.send(JSON.stringify(msg));
  return true;
}

function scheduleReconnect() {
  // No subs.size guard: the socket is opened at SIGN-IN and stays up for the
  // whole session, so the first bid in any room already has it ready. Gated
  // on being signed in, so sign-out genuinely ends it.
  if (retryTimer || !auth.currentUser) return;
  // Jittered (×0.5–1.5): an engine restart drops every client at once, and a
  // deterministic schedule sent them all back in lockstep waves — a reconnect
  // storm hitting the engine at exactly the moment it is trying to come back.
  retryTimer = setTimeout(() => {
    retryTimer = null;
    // Capped: a long outage should not turn into a busy loop, and there is no
    // urgency — HTTP is serving bids the whole time.
    retryMs = Math.min(retryMs * 2, 30_000);
    connect().catch(() => {});
  }, retryMs * (0.5 + Math.random()));
}

function handle(raw: string) {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  if (msg.t === 'hello') {
    authed = true;
    retryMs = 1000;
    // Re-subscribe everything after a reconnect, so a dropped socket restores
    // itself without the screens knowing it happened.
    for (const showId of subs.keys()) send({ t: 'sub', showId });
    log('connected');
    return;
  }

  if (msg.t === 'state' && typeof msg.showId === 'string') {
    subs.get(msg.showId)?.onState((msg.auctions as EngineAuction[]) ?? []);
    return;
  }

  if (msg.t === 'bid' && msg.auction) {
    const auction = msg.auction as EngineAuction;
    // Round trip for a bid THIS device sent: tap → engine → back. The number
    // that actually matters, measured rather than assumed.
    const sentAt = inflight.get(auction.id);
    if (sentAt !== undefined) {
      inflight.delete(auction.id);
      log(`bid round trip ${Date.now() - sentAt}ms`);
    }
    if (auction.showId) subs.get(auction.showId)?.onBid(auction);
    return;
  }

  // Settlement heads-up, sent the instant the engine closes a lot — before
  // the settle transaction and the Firestore fan-out. The frame is exactly
  // { t: "ended", auctionId } (settleWithApi in auction-engine/src/index.js):
  // it names an auction, not a show, so like errors it goes to every
  // subscriber — consumers match on an auction id they already hold.
  if (msg.t === 'ended' && typeof msg.auctionId === 'string') {
    const auctionId = msg.auctionId;
    for (const s of subs.values()) s.onEnded?.(auctionId);
    return;
  }

  if (msg.t === 'err') {
    const err: EngineError = {
      code: String(msg.code ?? 'ENGINE_ERROR'),
      message: String(msg.message ?? 'Something went wrong.'),
      auctionId: typeof msg.auctionId === 'string' ? msg.auctionId : undefined,
      minNext: typeof msg.minNext === 'number' ? msg.minNext : undefined,
    };

    // Stale-gate rescue: the engine judged this bid with the bidder context it
    // cached when the socket authenticated, which may predate the buyer's
    // Get Ready setup. Replay the SAME bid (same idempotency key) over HTTP,
    // which re-reads the profile fresh — and reconnect the socket so its next
    // judgement is current. Only the fresh HTTP verdict reaches the screen:
    // success means the gate was stale (say nothing, the listeners will paint
    // the accepted bid); failure means the rejection is real and the HTTP
    // error message is the accurate one.
    if (err.auctionId && STALE_CTX_CODES.has(err.code)) {
      const last = lastBids.get(err.auctionId);
      if (last && Date.now() - last.at < REPLAY_WINDOW_MS) {
        lastBids.delete(err.auctionId); // one replay per tap, never a loop
        const { auctionId } = err;
        log(`gate ${err.code} — replaying bid over HTTP`);
        reauth();
        placeBidHttp(auctionId, last.amount, last.idem)
          .then(() => log('HTTP replay accepted — socket gate was stale'))
          .catch((httpErr: unknown) => {
            const text = httpErr instanceof Error ? httpErr.message : String(httpErr);
            const m = text.match(/"message"\s*:\s*"([^"]+)"/);
            // Only a parsed HTTP verdict may be surfaced. A network
            // failure/timeout must NOT resurface the stale gate text — the
            // buyer would read "add a delivery address" seconds after doing
            // exactly that, when the truth is the bid was dropped in transit.
            const real: EngineError = m?.[1]
              ? { code: err.code, message: m[1], auctionId }
              : {
                  code: 'BID_FAILED',
                  message: 'Your bid didn’t go through — try again.',
                  auctionId,
                };
            for (const s of subs.values()) s.onError(real);
          });
        return;
      }
    }

    // An error names an auction, not a show, so it goes to every subscriber —
    // there is at most a handful, and mis-routing a rejection is worse than
    // delivering it broadly.
    for (const s of subs.values()) s.onError(err);
  }
}

/**
 * Tear the socket down and reconnect with a fresh auth, forcing the engine to
 * reload this bidder's commerce context (address, payment method, terms,
 * unpaid-wins). The engine caches that context for the LIFETIME of a
 * connection, so it must be called after anything that changes bid
 * eligibility — saving the Get Ready sheet, completing a winner payment.
 * Subscriptions survive: they re-send automatically on the next 'hello'.
 */
export function reauth(): void {
  if (!ENGINE_URL || !auth.currentUser) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  authed = false;
  retryMs = 1000;
  socket?.close(); // onclose nulls the socket and schedules the reconnect
  if (!socket) connect().catch(() => {});
}

/** Open the socket and authenticate. Resolves either way — failure is a
 *  normal, expected state, not an exception the caller has to handle. */
/** True while a connect() is between its guard and assigning `socket` (the
 *  token fetch is a real network await). Without this, a reconnect timer's
 *  connect() and a reauth()-triggered connect() could both pass the null-socket
 *  guard and open TWO sockets whose handlers then fight over module state. */
let connectInFlight = false;

export async function connect(): Promise<void> {
  if (!ENGINE_URL || socket || connectInFlight) return;
  connectInFlight = true;

  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (!token) {
    connectInFlight = false;
    return;
  }

  try {
    const ws = new WebSocket(ENGINE_URL);
    socket = ws;

    ws.onopen = () => {
      // The token goes in the FIRST MESSAGE, never the URL — URLs are logged.
      ws.send(JSON.stringify({ t: 'auth', token }));
    };
    ws.onmessage = (e) => handle(String(e.data));
    ws.onerror = () => {
      /* onclose always follows; reconnection is handled there */
    };
    ws.onclose = (e: { code?: number }) => {
      socket = null;
      authed = false;
      // 4001 CONNECTION_REPLACED: the engine closed THIS socket because the
      // same account authenticated from another device (per-uid cap, newest
      // wins). Reconnecting would evict that device right back — an endless
      // two-device fight. Final: HTTP keeps serving bids here; a fresh
      // connect happens naturally on next sign-in or reauth().
      if (e?.code === 4001) {
        log('connection replaced by another device — not reconnecting');
        return;
      }
      scheduleReconnect();
    };
  } catch {
    socket = null;
    authed = false;
    scheduleReconnect();
  } finally {
    connectInFlight = false;
  }
}

/** End the session's connection. Called on SIGN-OUT — the socket carries the
 *  signed-in user's identity, and without this it would survive into the next
 *  account's session on the same device. */
export function disconnect(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  authed = false;
  socket?.close();
  socket = null;
}

/** Watch a show's auctions. Returns an unsubscribe. Safe to call with the
 *  engine unavailable: the handlers simply never fire and the caller's
 *  Firestore listener keeps doing the job on its own. */
export function subscribe(
  showId: string,
  handlers: {
    onState: StateHandler;
    onBid: BidHandler;
    onError: ErrorHandler;
    onEnded?: EndedHandler;
  }
): () => void {
  subs.set(showId, { showId, ...handlers });
  if (isReady()) send({ t: 'sub', showId });
  else connect().catch(() => {});

  return () => {
    send({ t: 'unsub', showId });
    subs.delete(showId);
    // The socket deliberately STAYS OPEN with no subscriptions. It belongs to
    // the session (opened at sign-in), and closing it here meant the next
    // room's first bid found it cold and fell back to the ~1s HTTP path.
    // An idle authed socket costs a few bytes of ping — cheap against making
    // the first bid the reliably slowest one.
  };
}

/**
 * Try to place a bid over the socket.
 *
 * Returns FALSE when it could not be sent, and the caller must then fall back
 * to the HTTP path. It deliberately does not throw and does not wait for
 * confirmation: the engine broadcasts the accepted bid to everyone including
 * this device, and the panel is already showing it optimistically.
 */
export function placeBid(auctionId: string, amount: number, idem: string): boolean {
  const sent = send({ t: 'bid', auctionId, amount, idem });
  if (sent) {
    inflight.set(auctionId, Date.now());
    // Remembered so a stale-gate rejection can replay this exact bid over
    // HTTP (same idempotency key — a double delivery settles as one bid).
    lastBids.set(auctionId, { amount, idem, at: Date.now() });
  }
  return sent;
}
