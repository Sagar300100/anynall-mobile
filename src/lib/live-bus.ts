// The fast lane, buyer side.
//
// Auction state still streams from Firestore — that remains the source of
// truth. But every viewer already holds an open WebRTC connection to the
// LiveKit room for the video, and the server pushes each accepted bid down
// that same connection the instant the transaction commits (see
// functions/liveBus.js). So the room reacts at socket speed and Firestore
// confirms the identical state a moment later.
//
// Everything here is DEFENSIVE. A data packet is untrusted input off the
// network: it is parsed inside a try, every field is type-checked, and
// anything that doesn't look right is dropped rather than merged into what a
// buyer is about to bid against.

/** A bid the server has already committed. Never a prediction. */
export interface LiveBidEvent {
  t: 'bid';
  auctionId: string;
  amount: number;
  bidCount: number;
  bidderUid: string;
  bidderName: string;
  endsAt: string;
  extended: boolean;
  version: number;
}

export type LiveEvent = LiveBidEvent;

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Decode one LiveKit data packet. Returns null for anything that isn't an
 * event we understand — malformed JSON, an unknown type, a missing field.
 *
 * Deliberately strict about the numbers: `amount` and `version` decide what a
 * buyer sees as the price to beat, so a packet that is even slightly wrong is
 * worth less than no packet at all.
 */
export function decodeLiveEvent(payload: Uint8Array): LiveEvent | null {
  try {
    const text = new TextDecoder().decode(payload);
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) return null;
    const e = raw as Record<string, unknown>;
    if (e.t !== 'bid') return null;
    if (typeof e.auctionId !== 'string' || !e.auctionId) return null;
    if (!isFiniteInt(e.amount) || !isFiniteInt(e.version) || !isFiniteInt(e.bidCount)) return null;
    if (typeof e.endsAt !== 'string' || !e.endsAt) return null;

    return {
      t: 'bid',
      auctionId: e.auctionId,
      amount: e.amount,
      bidCount: e.bidCount,
      bidderUid: typeof e.bidderUid === 'string' ? e.bidderUid : '',
      bidderName: typeof e.bidderName === 'string' ? e.bidderName : '',
      endsAt: e.endsAt,
      extended: e.extended === true,
      version: e.version,
    };
  } catch {
    return null;
  }
}
