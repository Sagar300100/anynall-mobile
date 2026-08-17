// The seller's camera stage.
//
// Mounts only while the show is live. It asks for CAMERA and RECORD_AUDIO at
// the moment broadcasting starts — that is the first time the app has ever
// needed them, which is why nothing prompted before this existed.
//
// Connection order matters and is the usual source of "it connects but nobody
// sees anything":
//   1. AudioSession.startAudioSession() BEFORE connecting, so the OS routes
//      mic capture and playback correctly.
//   2. Room connect with the host token.
//   3. Publish camera + mic.
// Teardown reverses it, and must run on unmount or the mic stays hot.
import Ionicons from '@expo/vector-icons/Ionicons';
import { AudioSession, LiveKitRoom, useLocalParticipant, VideoTrack } from '@livekit/react-native';
import { Track, VideoPresets } from 'livekit-client';
import { useEffect, useState } from 'react';
import { ActivityIndicator, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { getStreamToken, streamErrorMessage, type StreamGrant } from '@/lib/stream';

/** Android needs runtime consent; iOS prompts on first capture via Info.plist. */
async function ensureCapturePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ]);
  return (
    granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED &&
    granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED
  );
}

export function BroadcastStage({
  showId,
  displayName,
  onError,
}: {
  showId: string;
  displayName?: string;
  onError?: (message: string) => void;
}) {
  const [grant, setGrant] = useState<StreamGrant | null>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'denied' | 'failed'>('starting');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const ok = await ensureCapturePermissions();
      if (cancelled) return;
      if (!ok) {
        setStatus('denied');
        return;
      }
      try {
        await AudioSession.startAudioSession();
        const g = await getStreamToken(showId, 'host', displayName);
        if (cancelled) return;
        setGrant(g);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('failed');
        onError?.(streamErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
      AudioSession.stopAudioSession().catch(() => {});
    };
    // displayName/onError deliberately excluded: re-minting a token because a
    // label changed would drop the broadcast mid-show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId]);

  if (status === 'denied') {
    return (
      <Notice
        icon="videocam-off-outline"
        text="Camera and microphone access were denied. Enable them in Settings to broadcast."
      />
    );
  }
  if (status === 'failed') {
    return <Notice icon="warning-outline" text="Couldn’t start the broadcast." />;
  }
  if (!grant) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#2E6BFF" />
        <Text style={styles.note}>Starting camera…</Text>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={grant.url}
      token={grant.token}
      connect
      video
      audio
      // dynacast OFF, deliberately.
      //
      // Dynacast pauses video layers nobody is subscribed to. That is the
      // right trade for a conference call with idle participants, and the
      // WRONG one for live shopping: the first buyer to open the show has to
      // wait for subscribe -> server tells publisher to resume -> encoder
      // produces a keyframe -> frame arrives. Every buyer opening a quiet show
      // pays that, and it is a large part of the cold-join delay.
      //
      // A seller is broadcasting to an audience; the camera should simply be
      // running. The cost is the seller's uplink while nobody is watching,
      // which is the cheaper side of this trade.
      //
      // Capture pinned to 720p so the encoder emits its first keyframe sooner
      // and weak Indian mobile uplinks are not the bottleneck.
      options={{
        adaptiveStream: true,
        dynacast: false,
        videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      }}
      onError={(err: Error) => onError?.(streamErrorMessage(err))}
    >
      <LocalCamera />
    </LiveKitRoom>
  );
}

/** Renders the seller's own camera track once it is published.
 *
 *  Uses `cameraTrack` from the hook rather than
 *  `localParticipant.getTrackPublication(...)`: the participant object's
 *  identity does not change when a track is published, so reading the
 *  publication off it left this stuck on "Publishing…" forever. `cameraTrack`
 *  is reactive and re-renders when the track goes live. */
function LocalCamera() {
  const { localParticipant, cameraTrack } = useLocalParticipant();
  if (!cameraTrack?.track) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#2E6BFF" />
        <Text style={styles.note}>Publishing…</Text>
      </View>
    );
  }
  return (
    <VideoTrack
      trackRef={{
        participant: localParticipant,
        publication: cameraTrack,
        source: Track.Source.Camera,
      }}
      style={styles.video}
    />
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
  center: { ...(StyleSheet.absoluteFill as object), alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  note: { color: 'rgba(159,180,216,0.8)', fontSize: 13, fontFamily: Fonts.sans, textAlign: 'center', lineHeight: 18 },
  video: { ...(StyleSheet.absoluteFill as object) },
});
