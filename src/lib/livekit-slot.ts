// One LiveKit connection, app-wide.
//
// LiveKit permits a single connection per identity, and this app opens rooms
// from TWO places: the Live tab warms one ahead of a tap (stream-join),
// and the live room holds one while you watch (viewer-stage). Neither could
// see the other's connection, so leaving a show and landing back on the Live
// tab reliably produced an overlap — the outgoing room was still tearing down
// (disconnect() is async and a React cleanup cannot await it) while the
// preconnect opened the next one.
//
// The server resolves that overlap by dropping one participant, which surfaced
// as "unable to set offer", "Local fingerprint does not match identity" and
// "ping timeout", usually with the video dying for a moment.
//
// This module makes the handover strictly sequential: whoever wants a
// connection claims the slot, and anyone opening a new one waits for the
// previous teardown to finish first. At most one connection exists at any
// instant, by construction rather than by timing.
import type { Room } from 'livekit-client';

let active: Room | null = null;
/** Resolves once the last evicted room has finished disconnecting. */
let teardown: Promise<unknown> = Promise.resolve();

/**
 * Take the slot for `next`, evicting whatever held it.
 *
 * Returns a promise that resolves when the previous holder is gone — callers
 * that are about to CONNECT must await it. Claiming with the room that already
 * holds the slot is a no-op, which is what makes handing a preconnected room
 * to the viewer free.
 */
export function claimSlot(next: Room): Promise<unknown> {
  if (active && active !== next) releaseSlot(active);
  active = next;
  return teardown;
}

/**
 * Give the slot up and disconnect.
 *
 * This is the ONE place a room is closed, and it records the disconnect so
 * `slotSettled()` can be waited on. The previous version only cleared the
 * pointer and left callers to disconnect separately — so `teardown` still held
 * an already-resolved promise from an earlier handover, `slotSettled()`
 * returned immediately, and the next connection opened while the last one was
 * still negotiating. livekit-client then processed a signal message against a
 * disposed engine: "Cannot read property 'client' of undefined".
 */
export function releaseSlot(room: Room): Promise<unknown> {
  if (active === room) active = null;
  teardown = room.disconnect().catch(() => {});
  return teardown;
}

/** Resolves when no connection is mid-teardown. Await before connecting. */
export function slotSettled(): Promise<unknown> {
  return teardown;
}

/** Is any room currently holding the slot? The preview card checks this
 *  before a RETRY, so it never steals the connection from a show the buyer
 *  is actively watching. */
export function hasActiveRoom(): boolean {
  return active !== null;
}
