// Unboxing recorder — the Gap 2 client primitive as a drop-in card.
//
// The next wave drops this into the buyer's order-detail screen once an order
// is delivered. Contract: { orderId, existingPath?, onSaved(path) } — the
// parent persists the returned path (order local state, then the complaint
// form) and can seed `existingPath` from the order doc so a revisit opens on
// the saved state instead of asking again.
//
// The captured asset is held across a failed upload, so Retry re-uploads the
// SAME take — a buyer must never have to re-film an unboxing over a network
// blip. Storage rules for unboxing/{uid}/{orderId} land backend-side in
// parallel; until they do, uploads fail and the card says "Couldn’t save the
// video — try again." — honest, never silent.
import Ionicons from '@expo/vector-icons/Ionicons';
import type * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { captureUnboxingVideo, uploadUnboxingVideo } from '@/lib/unboxing';

/** Success green — same as the verified checkmarks (sign-up, PAN screen). */
const SUCCESS = '#34D399';

type Phase = 'idle' | 'uploading' | 'error' | 'saved';

export function UnboxingRecorder({
  orderId,
  existingPath,
  onSaved,
}: {
  orderId: string;
  /** Already-saved video path from the order doc, if any — the card renders
   *  straight into its saved state. */
  existingPath?: string | null;
  /** Fires once the upload lands, with the storage path the complaint
   *  endpoint expects (`unboxing/{uid}/{orderId}/video.mp4`). */
  onSaved: (path: string) => void;
}) {
  const c = useBrandColors();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  // Survives a failed upload so Retry re-uploads the same take.
  const held = useRef<ImagePicker.ImagePickerAsset | null>(null);

  // Derived, never synced via an effect: `existingPath` can arrive late (the
  // order doc refreshing) and must read as saved — but only while this mount
  // hasn't started its own flow, whose phase then owns the card.
  const shown: Phase = phase === 'idle' && existingPath ? 'saved' : phase;

  async function uploadHeld() {
    const asset = held.current;
    if (!asset) return;
    setPhase('uploading');
    setProgress(0);
    AccessibilityInfo.announceForAccessibility('Uploading unboxing video');
    try {
      const path = await uploadUnboxingVideo(orderId, asset, setProgress);
      setPhase('saved');
      AccessibilityInfo.announceForAccessibility('Unboxing video saved');
      onSaved(path);
    } catch {
      // uploadUnboxingVideo already normalised the copy; the card's error
      // state renders it verbatim.
      setPhase('error');
      AccessibilityInfo.announceForAccessibility('Unboxing video upload failed');
    }
  }

  async function record() {
    if (shown === 'uploading') return;
    // null = cancelled, or the permission alert has already explained itself.
    const asset = await captureUnboxingVideo();
    if (!asset) return;
    held.current = asset;
    await uploadHeld();
  }

  const pct = Math.round(progress * 100);

  return (
    <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
      {shown === 'saved' ? (
        <>
          <View style={styles.titleRow}>
            <Ionicons name="shield-checkmark" size={18} color={SUCCESS} />
            <Text style={[styles.title, { color: c.text }]}>Video saved — you’re covered.</Text>
          </View>
          <Text style={[styles.body, { color: c.textSecondary }]}>
            Your unboxing video is attached to this order. If anything’s wrong, it backs your
            report inside the 24-hour window.
          </Text>
        </>
      ) : shown === 'uploading' ? (
        <>
          <View style={styles.titleRow}>
            <Ionicons name="cloud-upload-outline" size={18} color={c.primary} />
            <Text style={[styles.title, { color: c.text }]}>Saving your video…</Text>
          </View>
          <View
            style={[styles.progressTrack, { backgroundColor: c.backgroundSelected }]}
            accessibilityRole="progressbar"
            accessibilityLabel="Upload progress"
            accessibilityValue={{ min: 0, max: 100, now: pct }}
          >
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={[styles.progressLabel, { color: c.textSecondary }]}>{pct}%</Text>
        </>
      ) : (
        <>
          <View style={styles.titleRow}>
            <Ionicons name="videocam-outline" size={18} color={c.primary} />
            <Text style={[styles.title, { color: c.text }]}>Unboxing video</Text>
          </View>

          {shown === 'error' ? (
            <Text style={[styles.body, { color: c.danger }]}>
              Couldn’t save the video — try again.
            </Text>
          ) : (
            <Text style={[styles.body, { color: c.textSecondary }]}>
              Record yourself opening the package — up to 3 minutes. If anything’s wrong with the
              order, this video is your proof when you report it.
            </Text>
          )}

          {shown === 'error' ? (
            <>
              <Pressable
                onPress={uploadHeld}
                accessibilityRole="button"
                accessibilityLabel="Retry saving the video"
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="refresh" size={17} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>Try again</Text>
              </Pressable>
              <Pressable
                onPress={record}
                accessibilityRole="button"
                accessibilityLabel="Record a new video"
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.ghostBtnText, { color: c.primary }]}>Record a new video</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={record}
              accessibilityRole="button"
              accessibilityLabel="Record unboxing video"
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="videocam" size={17} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Record unboxing video</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two + Spacing.one,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  body: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2E6BFF',
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  ghostBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  ghostBtnText: { fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: '#2E6BFF' },
  progressLabel: { fontSize: 12, fontFamily: Fonts.mono },
});
