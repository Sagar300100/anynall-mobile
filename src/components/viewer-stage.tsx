// The buyer's video stage — subscribes to the seller's camera.
//
// Needs no permissions: a viewer publishes nothing, so the camera and mic are
// never opened on this side.
//
// The token request is also the live check. streamRouter refuses a viewer
// token with SHOW_NOT_LIVE unless the host has actually opened the room, so a
// show that merely *says* it is live still lands on an honest message here
// rather than an empty black rectangle.
import Ionicons from '@expo/vector-icons/Ionicons';
import { AudioSession, RoomContext, useTracks, VideoTrack } from '@livekit/react-native';
import { Image } from 'expo-image';
import { Room, RoomEvent, Track } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { decodeLiveEvent, type LiveEvent } from '@/lib/live-bus';
import { msSinceTap, streamErrorMessage, type StreamGrant } from '@/lib/stream';
import { adoptJoin, getSharedJoin, parkJoin, setPreviewMode } from '@/lib/stream-join';

export function ViewerStage({
  showId,
  displayName,
  posterUrl,
  onLiveEvent,
}: {
  showId: string;
  displayName?: string;
  /** Show thumbnail, held behind the stream so joining never flashes black. */
  posterUrl?: string | null;
  /** Server-pushed room events (bids) arriving over the video connection.
   *  MUST be referentially stable — this screen re-renders every second on the
   *  auction tick, and an inline arrow here would resubscribe each time. */
  onLiveEvent?: (event: LiveEvent) => void;
}) {
  // ADOPT the join, never start it here. The tap handler (or the Live tab's
  // warm-up) already began the token + connect; by the time this screen has
  // finished animating in, that work is underway or done. Adopted
  // synchronously on first render so LiveKitRoom gets the very Room object
  // that is already connecting — the screen owning it is also what lets the
  // bid fast-lane listen on the same connection.
  // The Live tab's preview card may already hold this show's connection with
  // the decoder hot — reuse it, because that is the entire trick. When we do,
  // the CARD keeps ownership: this screen only flips the connection between
  // preview mode (muted, low layer) and full mode, and never parks it.
  const [{ join, owned }] = useState(() => {
    const sharedHandle = getSharedJoin(showId);
    return sharedHandle
      ? { join: sharedHandle, owned: false }
      : { join: adoptJoin(showId, displayName), owned: true };
  });
  const room = join.room;
  const [grant, setGrant] = useState<StreamGrant | null>(null);
  // The unmount cleanup needs the grant, and its closure only sees mount-time
  // state — a ref is the escape hatch.
  const grantRef = useRef<StreamGrant | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mountedAt] = useState(() => Date.now());

  // ── The fast lane ──
  // Bids the server has already committed, arriving over the connection this
  // screen is holding open for the video, instead of waiting for Firestore to
  // fan them out.
  useEffect(() => {
    if (!onLiveEvent) return;
    const handle = (payload: Uint8Array, participant?: unknown) => {
      // Packets sent through the SERVER API arrive with no participant; one
      // published by another client carries theirs. Only the server may move
      // the price, so anything with a sender is ignored — a viewer must not be
      // able to fake a bid on everyone else's screen.
      if (participant) return;
      const event = decodeLiveEvent(payload);
      if (event) onLiveEvent(event);
    };
    room.on(RoomEvent.DataReceived, handle);
    return () => {
      room.off(RoomEvent.DataReceived, handle);
    };
  }, [room, onLiveEvent]);

  useEffect(() => {
    let cancelled = false;

    // Fire the audio session WITHOUT awaiting it. It only decides whether
    // playback routes to the speaker or the earpiece, and awaiting it used to
    // sit in front of the token round trip, adding dead time to every join.
    AudioSession.startAudioSession().catch(() => {});

    const t0 = Date.now();
    console.warn('[join] t0 stage mounted (adopting in-flight join)');

    // The join was started at the tap; this just waits for its result.
    join.ready.then(
      (g) => {
        console.warn(`[join] connect ready +${Date.now() - t0}ms after mount${owned ? '' : ' (shared with preview card)'}`);
        grantRef.current = g;
        // Sound on, full resolution — the buyer is IN the room now.
        setPreviewMode(join, false);
        if (!cancelled) setGrant(g);
      },
      (err) => {
        console.warn(`[join] FAILED +${Date.now() - t0}ms after mount`);
        if (!cancelled) setProblem(streamErrorMessage(err));
      }
    );

    return () => {
      cancelled = true;
      AudioSession.stopAudioSession().catch(() => {});
      if (owned) {
        // NOT a disconnect. The room is PARKED, still connected, so browsing
        // back in within the linger window resumes the live subscription.
        parkJoin(showId, join, grantRef.current);
      } else {
        // The preview card owns this connection and is still rendering it —
        // just hand it back: mute, drop to the low layer, keep decoding.
        setPreviewMode(join, true);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId]);

  // The poster sits underneath everything for the whole join, so the buyer
  // sees the show immediately and the video fades in over it. Previously this
  // was a black screen through "Connecting…" then "Waiting for the seller's
  // camera…" — two full-screen states back to back, which read as a long hang
  // even though only the last stretch was real waiting.
  return (
    <View style={StyleSheet.absoluteFill as object}>
      {!!posterUrl && (
        <Image source={{ uri: posterUrl }} style={styles.poster} contentFit="cover" />
      )}
      {problem ? (
        <Notice icon="videocam-off-outline" text={problem} />
      ) : !grant ? (
        <Joining />
      ) : (
        <LiveStream grant={grant} room={room} mountedAt={mountedAt} showId={showId} />
      )}
    </View>
  );
}

/** Unobtrusive "still joining" hint — deliberately small, because the poster
 *  behind it already gives the buyer something to look at. */
function Joining() {
  return (
    <View style={styles.joining}>
      <ActivityIndicator color="#FFFFFF" size="small" />
    </View>
  );
}

function LiveStream({
  grant,
  room,
  mountedAt,
  showId,
}: {
  grant: StreamGrant;
  room: Room;
  mountedAt: number;
  showId: string;
}) {
  // RoomContext.Provider, NOT <LiveKitRoom>.
  //
  // LiveKitRoom DISCONNECTS on unmount the room it was given. When the room is
  // shared with the Live tab's preview card, leaving the show therefore killed
  // the card's connection — so the next tap found nothing warm and paid a full
  // ~2s cold join. Measured: the tap that DID reuse the card's connection was
  // 292ms; the ones after a teardown were 1962ms and 2044ms.
  //
  // The room is already connected by stream-join before `grant` resolves, and
  // ownership/teardown is stream-join's job (park or hand back to the card).
  // All the hooks below need is the room in context.
  void grant;
  return (
    <RoomContext.Provider value={room}>
      <RemoteVideo mountedAt={mountedAt} showId={showId} />
    </RoomContext.Provider>
  );
}

function RemoteVideo({ mountedAt, showId }: { mountedAt: number; showId: string }) {
  // onlySubscribed: false — surface the publication as soon as the seller
  // publishes, not only once it is already subscribed. Rendering the
  // VideoTrack is what drives subscription.
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  // The seller is the only publisher the room grants canPublish to, so the
  // first remote camera track is the show.
  const remote = tracks.find((t) => !t.participant.isLocal);

  const hasTrack = !!remote?.publication?.track;
  // TAP → FIRST FRAME is the number a buyer actually experiences, and in a
  // dev build it is shown ON SCREEN — console timings and a person's felt
  // delay kept disagreeing, and a number both can read settles it.
  const [joinMs, setJoinMs] = useState<number | null>(null);
  useEffect(() => {
    if (!hasTrack) return;
    const sinceTap = msSinceTap(showId);
    // Deferred a tick: the React Compiler rejects a synchronous setState in
    // an effect body as a cascading render.
    const t = setTimeout(() => setJoinMs(sinceTap), 0);
    console.warn(
      `[join] FIRST FRAME: ${sinceTap === null ? 'n/a' : `${sinceTap}ms from TAP`}` +
        ` (${Date.now() - mountedAt}ms from stage mount)`
    );
    return () => clearTimeout(t);
  }, [hasTrack, mountedAt, showId]);
  // No full-screen "waiting" state: the poster is already showing underneath,
  // so we simply render nothing here until the track arrives.
  if (!remote) return <Joining />;
  return (
    <>
      <VideoTrack trackRef={remote} style={styles.video} />
      {__DEV__ && joinMs !== null && (
        <View style={styles.joinChip} pointerEvents="none">
          <Text style={styles.joinChipText}>▶ {(joinMs / 1000).toFixed(2)}s</Text>
        </View>
      )}
    </>
  );
}

function Notice({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={26} color="rgba(159,180,216,0.7)" />
      <Text style={styles.note}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  poster: { ...(StyleSheet.absoluteFill as object), opacity: 0.55 },
  // Dev-only: tap → first-frame, readable on the device itself. Compiled out
  // of release builds by the __DEV__ guard at the render site.
  joinChip: {
    position: 'absolute',
    top: 110,
    left: 12,
    backgroundColor: 'rgba(8,16,34,0.8)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  joinChipText: { color: '#7CFFB2', fontSize: 12, fontFamily: Fonts.mono },
  joining: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { ...(StyleSheet.absoluteFill as object), alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  note: { color: 'rgba(159,180,216,0.8)', fontSize: 13, fontFamily: Fonts.sans, textAlign: 'center', lineHeight: 18 },
  video: { ...(StyleSheet.absoluteFill as object) },
});
