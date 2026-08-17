// The Live tab card that PLAYS the show.
//
// This is the mechanism behind "instant": the card is a muted, low-layer
// live subscription, so the decoder is already hot while the buyer is still
// browsing. Tapping the card doesn't start a join — the room screen picks up
// this very connection (getSharedJoin) and merely flips it to full mode:
// audio on, high simulcast layer. No token, no handshake, no keyframe wait.
//
// Rules that keep it honest and cheap:
//   • Wi-Fi only. A speculative live subscription costs real data; on
//     cellular the card falls back to its thumbnail and the tap starts the
//     join (still fast — the engine mints tokens in ~350ms).
//   • RETRIES. A show that isn't broadcasting yet (or a dropped connection)
//     is retried every few seconds while the card is on screen — without
//     this, a card whose first attempt failed stayed dead forever and a tap
//     on it paid a full cold join. Retries never run while some OTHER show
//     holds the connection, so browsing can't sabotage watching.
//   • Muted, always, including tracks that arrive late — unless the room
//     screen currently has the connection checked out (handle.inUse).
import NetInfo from '@react-native-community/netinfo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { RoomContext, useTracks, VideoTrack } from '@livekit/react-native';
import { Image } from 'expo-image';
import { RoomEvent, Track } from 'livekit-client';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { ShowData } from '@/lib/api';
import {
  adoptJoin,
  parkJoin,
  registerSharedJoin,
  setPreviewMode,
  startJoin,
  unregisterSharedJoin,
  type JoinHandle,
} from '@/lib/stream-join';

/** How long a dead or not-yet-live card waits before trying again. */
const RETRY_MS = 8_000;

export function LiveCardPreview({
  show,
  width,
  height,
  onPress,
  renderVideo = true,
}: {
  show: ShowData;
  width: number;
  height: number;
  onPress: () => void;
  /** False while the Live tab is off screen. Releases the video VIEW (two
   *  views cannot attach to one track, and the open room needs it) without
   *  touching the connection — which is what keeps re-entry instant. */
  renderVideo?: boolean;
}) {
  const showId = String(show.id);
  const [join, setJoin] = useState<JoinHandle | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let handle: JoinHandle | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      if (retry) clearTimeout(retry);
      retry = setTimeout(tryStart, RETRY_MS);
    };

    const dropHandle = () => {
      if (!handle) return;
      unregisterSharedJoin(showId, handle);
      handle = null;
      if (!cancelled) {
        setJoin(null);
        setPlaying(false);
      }
    };

    async function tryStart() {
      if (cancelled || handle) return;
      const net = await NetInfo.fetch();
      if (cancelled) return;
      // Cellular: no speculative video — the thumbnail stays, the tap joins.
      if (net.type !== 'wifi') return schedule();
      const h = adoptJoin(showId, undefined, true); // speculative: slotless
      handle = h;
      registerSharedJoin(showId, h);

      // Late tracks come up muted too — unless the room screen has the
      // connection checked out, in which case muting would silence the show.
      h.room.on(RoomEvent.TrackSubscribed, () => {
        if (handle === h && !h.inUse) setPreviewMode(h, true);
      });
      h.room.on(RoomEvent.Disconnected, () => {
        if (handle !== h) return;
        dropHandle();
        schedule(); // evicted or dropped — try again when the coast is clear
      });

      h.ready.then(
        () => {
          if (cancelled || handle !== h) return;
          setPreviewMode(h, true);
          setJoin(h);
          setPlaying(true);
        },
        () => {
          // Usually SHOW_NOT_LIVE — the seller hasn't started (or has ended).
          if (handle !== h) return;
          dropHandle();
          schedule();
        }
      );
    }

    tryStart();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      if (handle) {
        const h = handle;
        unregisterSharedJoin(showId, h);
        // parkJoin releases the slot itself when there's nothing connected to
        // keep. In practice this cleanup runs on sign-out or a full reload —
        // an open room screen keeps the tab (and this card) mounted.
        if (h.room.state === 'connected') parkJoin(showId, h, null);
        else if (h.room.state !== 'disconnected') h.room.disconnect().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId]);

  return (
    <Pressable
      onPress={() => {
        // A dead card must still be a FAST card: if the preview isn't live,
        // start the join at the tap so it overlaps the screen transition.
        if (!join || join.room.state !== 'connected') startJoin(showId);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Live show: ${show.name}${show.seller ? ` by ${show.seller}` : ''}`}
      style={({ pressed }) => [styles.card, { width, height }, pressed && { opacity: 0.85 }]}
    >
      {/* Thumbnail underneath, always — the video fades in over it, and any
          failure just leaves the card exactly as it used to be. */}
      {show.thumbnail ? (
        <Image source={{ uri: show.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={styles.fallback}>
          <Ionicons name="videocam-outline" size={28} color="rgba(159,180,216,0.4)" />
        </View>
      )}

      {playing && join && renderVideo && (
        // RoomContext, not <LiveKitRoom> — LiveKitRoom disconnects the room it
        // is given when it unmounts, which tore down the very connection this
        // card exists to keep alive. stream-join owns the lifecycle.
        <RoomContext.Provider value={join.room}>
          <PreviewVideo />
        </RoomContext.Provider>
      )}

      <View style={styles.badge}>
        <View style={styles.dot} />
        <Text style={styles.badgeText}>LIVE</Text>
      </View>
      <View style={styles.scrim}>
        <Text numberOfLines={1} style={styles.title}>
          {show.name}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {show.seller ? `by @${show.seller}` : show.sellerName || 'Live show'}
        </Text>
      </View>
    </Pressable>
  );
}

function PreviewVideo() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remote = tracks.find((t) => !t.participant.isLocal);
  if (!remote?.publication?.track) return null;
  return <VideoTrack trackRef={remote} style={StyleSheet.absoluteFill as object} />;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(74,143,229,0.2)',
    backgroundColor: '#0A1428',
    overflow: 'hidden',
  },
  fallback: { ...(StyleSheet.absoluteFill as object), alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E5484D',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  badgeText: { color: '#FFFFFF', fontSize: 10.5, fontFamily: Fonts.sansSemiBold, letterSpacing: 0.5 },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
    gap: 1,
    backgroundColor: 'rgba(3,7,18,0.55)',
  },
  title: { color: '#FFFFFF', fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  meta: { color: 'rgba(200,215,240,0.85)', fontSize: 11.5, fontFamily: Fonts.sans },
});
