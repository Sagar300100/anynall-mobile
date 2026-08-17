// The one place a viewer join happens.
//
// The measured problem: tap → navigate → transition → screen mounts → token →
// connect → keyframe, all SERIAL. The screen mount alone is hundreds of ms in
// a dev build, and the token+connect only began after it — which is how the
// on-device chip read 1.3–2.9s while the stage-relative log claimed ~100ms.
//
// The fix is structural: startJoin() begins the ENTIRE join (token, slot,
// connect) the moment it is called — from the tap handler, or speculatively
// from the Live tab — and the screen ADOPTS whatever is already in flight
// instead of starting its own. The serial chain becomes
//
//     max(screen transition, token + connect)  +  keyframe
//
// Ownership rules:
//   • A join not adopted within IDLE_MS disconnects itself — a speculative
//     warm must never leave a buyer holding a live subscription they never
//     opened.
//   • adoptJoin() transfers ownership to the screen; the screen's teardown
//     (releaseSlot) is then what closes the room.
//   • The livekit-slot is still the single-connection authority underneath:
//     starting a join for show B evicts show A's room, wherever it came from.
import { Room, RoomEvent, Track, VideoQuality, type RemoteTrackPublication } from 'livekit-client';

import { claimSlot, releaseSlot, slotSettled } from './livekit-slot';
import { getStreamToken, type StreamGrant } from './stream';

export interface JoinHandle {
  showId: string;
  room: Room;
  /** Resolves once the room is CONNECTED; rejects with the token/connect
   *  error. The room object itself is usable (for event listeners) at once. */
  ready: Promise<StreamGrant>;
  adopted: boolean;
  /** True while the full room screen is using this connection. The preview
   *  card checks it before re-muting late-arriving audio tracks, so a card
   *  behind the open room can never silence the show. */
  inUse: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Dropped if no screen adopts the join by then. */
const IDLE_MS = 45_000;

const joins = new Map<string, JoinHandle>();

function drop(handle: JoinHandle, reason: string) {
  if (joins.get(handle.showId) === handle) joins.delete(handle.showId);
  if (handle.timer) {
    clearTimeout(handle.timer);
    handle.timer = null;
  }
  releaseSlot(handle.room);
  console.warn(`[join] dropped ${handle.showId} (${reason})`);
}

/**
 * Begin (or reuse) the full join for a show. Idempotent per show: the tap
 * handler, the Live tab's warm-up and the screen can all call this and share
 * one connection attempt.
 */
export function startJoin(showId: string, displayName?: string, speculative = false): JoinHandle {
  const existing = joins.get(showId);
  if (existing) return existing;

  // A parked room for this show resumes instead of rebuilding: the
  // subscription is still live, so there is no token, no handshake and no
  // keyframe wait — this is the "instant" path for browsing back in.
  const resumed = takeParked(showId);
  if (resumed) {
    const handle = resumed.handle;
    handle.adopted = false;
    handle.ready = Promise.resolve(resumed.grant);
    handle.timer = setTimeout(() => {
      if (!handle.adopted) drop(handle, 'idle');
    }, IDLE_MS);
    joins.set(showId, handle);
    return handle;
  }

  const room = new Room({ adaptiveStream: false });
  const handle: JoinHandle = { showId, room, ready: undefined as never, adopted: false, inUse: false, timer: null };

  handle.ready = (async () => {
    // Token first — it needs no slot, so it overlaps a previous room's
    // teardown instead of queueing behind it.
    const grant = await getStreamToken(showId, 'viewer', displayName);
    // SPECULATIVE joins (preview cards) skip the slot entirely. The slot
    // exists so that fullscreen rooms hand over cleanly; previews are
    // many-at-once by design, and every viewer connection now has its own
    // LiveKit identity, so they cannot collide the way same-identity
    // connections once did.
    if (!speculative) {
      await slotSettled();
      // Superseded while waiting (another show started, or we were dropped)?
      if (joins.get(showId) !== handle && !handle.adopted) throw new Error('JOIN_SUPERSEDED');
      await claimSlot(room);
    }
    await room.connect(grant.url, grant.token);
    return grant;
  })();

  // A failed or evicted join removes itself; the next call starts fresh.
  handle.ready.catch(() => drop(handle, 'failed'));
  room.on(RoomEvent.Disconnected, () => {
    if (!handle.adopted) drop(handle, 'evicted');
  });

  handle.timer = setTimeout(() => {
    if (!handle.adopted) drop(handle, 'idle');
  }, IDLE_MS);

  joins.set(showId, handle);
  return handle;
}

/** The screen takes ownership. From here parkJoin() (or eviction) closes the
 *  room; the idle timer and self-drop no longer apply. */
export function adoptJoin(showId: string, displayName?: string, speculative = false): JoinHandle {
  const handle = startJoin(showId, displayName, speculative);
  handle.adopted = true;
  if (handle.timer) {
    clearTimeout(handle.timer);
    handle.timer = null;
  }
  // Out of the registry: a future startJoin for this show is a fresh join,
  // not a second adoption of a room another screen already owns.
  joins.delete(showId);
  return handle;
}

// ── The linger ─────────────────────────────────────────────────────────────
//
// Why leaving a room does NOT disconnect it: a brand-new WebRTC subscription
// can never be instant — token, DTLS, ICE, then a keyframe begged from the
// publisher. The apps that FEEL instant never rebuild that pipeline while a
// buyer is browsing; the subscription is simply still there when they come
// back. So on leave the room is PARKED, connected, for LINGER_MS:
//
//   • re-entering the same show inside the window adopts a live subscription —
//     the first frame is just the next frame that arrives (~tens of ms);
//   • AUDIO is unsubscribed while parked, so a show never keeps talking from
//     a screen the buyer has left — video-only costs bandwidth but makes no
//     sound, and resubscribing audio on re-entry is fast;
//   • entering a DIFFERENT show evicts the parked room through the slot,
//     exactly like any other handover;
//   • the timer disconnects it for real if the buyer doesn't come back.

const LINGER_MS = 30_000;

interface Parked {
  showId: string;
  handle: JoinHandle;
  grant: StreamGrant;
  timer: ReturnType<typeof setTimeout>;
}

let parked: Parked | null = null;

/** Pause or resume EVERY subscription on a parked room.
 *
 *  Both kinds, deliberately. Audio so a left show never keeps talking. Video
 *  because of how frames start: a re-attached view cannot paint until the
 *  next KEYFRAME, and a publisher only volunteers one every couple of
 *  seconds — measured 1.6–2.3s to first frame on resumed rooms that were
 *  connected the whole time. RE-subscribing makes the SFU ask the publisher
 *  for a keyframe (PLI) immediately, which is the same fast path a fresh
 *  join gets. The connection itself never drops; only the tracks pause. */
function setTracksSubscribed(room: Room, on: boolean) {
  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.trackPublications.values()) {
      if (pub.kind === Track.Kind.Audio || pub.kind === Track.Kind.Video) {
        pub.setSubscribed(on);
      }
    }
  }
}

function dropParked(reason: string) {
  if (!parked) return;
  const p = parked;
  parked = null;
  clearTimeout(p.timer);
  releaseSlot(p.handle.room);
  console.warn(`[join] linger ended for ${p.showId} (${reason})`);
}

/** Called by the room screen on unmount INSTEAD of disconnecting. */
export function parkJoin(showId: string, handle: JoinHandle, grant: StreamGrant | null): void {
  // Never park a room that isn't actually connected — nothing to reuse.
  if (!grant || handle.room.state !== 'connected') {
    releaseSlot(handle.room);
    return;
  }
  dropParked('superseded');
  setTracksSubscribed(handle.room, false);
  parked = {
    showId,
    handle,
    grant,
    timer: setTimeout(() => dropParked('idle'), LINGER_MS),
  };
  // If the slot evicts this room (buyer opened a different show), the parked
  // entry must not outlive the connection it wraps.
  handle.room.once(RoomEvent.Disconnected, () => {
    if (parked?.handle === handle) dropParked('evicted');
  });
  console.warn(`[join] parked ${showId} — re-entry within ${LINGER_MS / 1000}s is instant`);
}

/** A parked, still-connected room for this show, or null. */
export function takeParked(showId: string): { handle: JoinHandle; grant: StreamGrant } | null {
  if (!parked || parked.showId !== showId) return null;
  if (parked.handle.room.state !== 'connected') {
    dropParked('stale');
    return null;
  }
  const p = parked;
  parked = null;
  clearTimeout(p.timer);
  setTracksSubscribed(p.handle.room, true);
  console.warn(`[join] resumed ${showId} from linger`);
  return { handle: p.handle, grant: p.grant };
}

// ── Sharing a join between the preview card and the room screen ────────────
//
// The Live tab's first card PLAYS the show (muted, low quality). Opening that
// show must reuse the very same connection — the whole point is that the
// decoder never goes cold — so the card registers its handle here and the
// room screen picks it up instead of building its own.

const shared = new Map<string, JoinHandle>();

export function registerSharedJoin(showId: string, handle: JoinHandle): void {
  shared.set(showId, handle);
}

export function unregisterSharedJoin(showId: string, handle: JoinHandle): void {
  if (shared.get(showId) === handle) shared.delete(showId);
}

/** The card's live handle for this show, if one is playing right now. */
export function getSharedJoin(showId: string): JoinHandle | null {
  const handle = shared.get(showId);
  if (!handle) return null;
  // A dead connection is worse than none: the caller would render black.
  if (handle.room.state === 'disconnected') {
    shared.delete(showId);
    return null;
  }
  return handle;
}

/**
 * Preview mode: video at the LOW simulcast layer, audio unsubscribed —
 * a browsing feed must neither talk nor burn full-resolution bandwidth.
 * Full mode: audio on, HIGH layer.
 *
 * Only ever touches subscriptions, never the connection — flipping between
 * the two is what makes expand feel instant.
 */
export function setPreviewMode(handle: JoinHandle, preview: boolean): void {
  handle.inUse = !preview;
  for (const participant of handle.room.remoteParticipants.values()) {
    for (const pub of participant.trackPublications.values()) {
      if (pub.kind === Track.Kind.Audio) {
        pub.setSubscribed(!preview);
      } else if (pub.kind === Track.Kind.Video) {
        (pub as RemoteTrackPublication).setVideoQuality(preview ? VideoQuality.LOW : VideoQuality.HIGH);
      }
    }
  }
}
