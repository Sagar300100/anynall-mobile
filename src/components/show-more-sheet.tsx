// Show Room → More. The seller's control panel for a show.
//
// One horizontal row of actions — with four of them, a wrapping grid left a
// ragged half-empty second row, so they sit side by side instead.
//
// WHAT IS REAL:
//   • Cancel Show — deletes the show (owner-only per firestore.rules).
//   • Edit Show — reopens the scheduling form in edit mode.
//   • Clone Items — genuinely copies the listings from another of your shows
//     into this one, through the same POST /api/products every listing uses.
//
// WHAT IS NOT: Create Poll. There is no poll collection and no live results
// channel, so it is visibly dimmed and says what it would need when tapped.
//
// Verified Buyers, Add Coupons, Tip Settings and Multicast were dropped from
// this sheet on request.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TONE } from '@/components/listing-parts';
import { Fonts, Spacing } from '@/constants/theme';
import type { ShowData } from '@/lib/api';
import { createProduct, getMyProducts, type ProductKind } from '@/lib/seller-hub';
import { deleteShow, fetchMyOtherShows } from '@/lib/shows';
import { endStream } from '@/lib/stream';

/** Copying a whole back catalogue in one tap would be a surprise, so the
 *  action is bounded and the bound is reported rather than applied silently. */
const CLONE_MAX = 25;

const ACTION_COUNT = 4;
const ROW_GAP = 10;
/** Exact width for one row of ACTION_COUNT tiles. Percentage widths plus
 *  `gap` round badly enough on a 720px screen to wrap the last tile. */
function tileWidth(screenWidth: number): number {
  return Math.floor(
    (screenWidth - Spacing.three * 2 - ROW_GAP * (ACTION_COUNT - 1)) / ACTION_COUNT
  );
}

export function ShowMoreSheet({
  visible,
  showId,
  onClose,
  onCloned,
}: {
  visible: boolean;
  showId: string;
  onClose: () => void;
  /** Fired after a successful clone so the Shop badge can refresh. */
  onCloned: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tileW = tileWidth(width);
  const [clonePicker, setClonePicker] = useState(false);

  function confirmCancel() {
    Alert.alert('Cancel this show?', 'It will no longer be available to viewers.', [
      { text: 'Keep Show', style: 'cancel' },
      {
        text: 'Cancel Show',
        style: 'destructive',
        onPress: async () => {
          try {
            // Close the live gate BEFORE deleting the doc. Cancelling
            // mid-live otherwise left liveRooms.live=true with the show doc
            // gone — viewers kept minting tokens into a deleted show, and
            // /end can only close the gate while the doc still exists (it
            // 404s afterwards). Harmless no-op for a show that isn't live.
            await endStream(showId).catch(() => {});
            await deleteShow(showId);
            router.replace('/sell');
          } catch {
            Alert.alert('Couldn’t cancel', 'Please try again.');
          }
        },
      },
    ]);
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.grabber} />

          <Text style={styles.sheetTitle}>Show controls</Text>

          {/* One row, four across. No wrap and no scroll — they fit. */}
          <View style={styles.row}>
            <Tile w={tileW} icon="ban-outline" label="Cancel Show" destructive onPress={confirmCancel} />
            <Tile
              w={tileW}
              icon="duplicate-outline"
              label="Clone Items"
              onPress={() => {
                onClose();
                setClonePicker(true);
              }}
            />
            <Tile
              w={tileW}
              icon="pencil-outline"
              label="Edit Show"
              onPress={() => {
                onClose();
                router.push(`/show-new?id=${showId}`);
              }}
            />
            <Tile
              w={tileW}
              icon="list-outline"
              label="Create Poll"
              unavailable
              reason="Polls need their own collection and a live results channel. Neither exists yet."
            />
          </View>
        </View>
      </Modal>

      <ClonePicker
        visible={clonePicker}
        showId={showId}
        onClose={() => setClonePicker(false)}
        onCloned={onCloned}
      />
    </>
  );
}

function Tile({
  w,
  icon,
  label,
  onPress,
  destructive,
  unavailable,
  reason,
}: {
  w: number;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  unavailable?: boolean;
  reason?: string;
}) {
  const color = destructive ? '#FF6B6B' : unavailable ? TONE.faint : TONE.text;
  return (
    <Pressable
      onPress={unavailable ? () => Alert.alert(label, reason ?? 'Not available yet.') : onPress}
      accessibilityRole="button"
      accessibilityLabel={unavailable ? `${label}. Not available yet` : label}
      style={({ pressed }) => [
        styles.tile,
        { width: w },
        unavailable && styles.tileOff,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Ionicons name={icon} size={26} color={color} />
      <Text style={[styles.tileLabel, { color }]} numberOfLines={2}>
        {label}
      </Text>
      {unavailable && <Text style={styles.tileNote}>Not available yet</Text>}
    </Pressable>
  );
}

/** Pick one of the seller's other shows and copy its listings into this one. */
function ClonePicker({
  visible,
  showId,
  onClose,
  onCloned,
}: {
  visible: boolean;
  showId: string;
  onClose: () => void;
  onCloned: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [shows, setShows] = useState<ShowData[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [others, mine] = await Promise.all([fetchMyOtherShows(showId), getMyProducts()]);
      const byShow: Record<string, number> = {};
      for (const p of mine.products) {
        if (p.showId) byShow[p.showId] = (byShow[p.showId] ?? 0) + 1;
      }
      setCounts(byShow);
      // Only shows that actually have something to copy are worth listing.
      setShows(others.filter((s) => (byShow[s.id] ?? 0) > 0));
    } catch {
      setShows([]);
    }
  }, [showId]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, load]);

  async function clone(source: ShowData) {
    const sourceId = String(source.id);
    setBusy(sourceId);
    try {
      const mine = await getMyProducts();
      const fromSource = mine.products.filter((p) => p.showId === sourceId);
      const items = fromSource.slice(0, CLONE_MAX);
      const total = fromSource.length;

      let copied = 0;
      for (const p of items) {
        // A clone must carry EVERY field the create route accepts — dropping
        // shipping data here is how a copied listing silently ships free and
        // books its courier at the 50g fallback weight.
        await createProduct({
          title: p.title,
          price: p.price,
          stock: p.stock,
          kind: p.kind as ProductKind,
          description: p.description,
          category: p.category,
          condition: p.condition,
          sku: p.sku,
          hazmat: p.hazmat,
          images: p.images,
          thumbnail_url: p.thumbnail_url,
          shippingFee: p.shippingFee,
          weightGrams: p.weightGrams ?? undefined,
          dimensionsCm: p.dimensionsCm ?? undefined,
          costPaise: p.costPaise ?? undefined,
          showId,
          temporary: p.temporary,
          auction: p.auctionConfig,
        });
        copied += 1;
      }
      onCloned();
      onClose();
      Alert.alert(
        'Items cloned',
        total > copied
          ? `Copied ${copied} of ${total} listings. Cloning is capped at ${CLONE_MAX} at a time — run it again for the rest.`
          : `Copied ${copied} listing${copied === 1 ? '' : 's'} into this show.`
      );
    } catch {
      Alert.alert('Couldn’t clone', 'Some listings may not have copied. Check the Shop panel.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.grabber} />
        <Text style={styles.pickerTitle}>Clone Items</Text>
        <Text style={styles.pickerBody}>
          Copy the listings from another of your shows into this one. The originals stay where they
          are.
        </Text>

        {shows === null ? (
          <ActivityIndicator color={TONE.primary} style={{ marginVertical: Spacing.four }} />
        ) : shows.length === 0 ? (
          <Text style={styles.pickerBody}>
            None of your other shows have listings to copy yet.
          </Text>
        ) : (
          <ScrollView style={{ maxHeight: 340 }}>
            {shows.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => clone(s)}
                disabled={busy !== null}
                accessibilityRole="button"
                accessibilityLabel={`Clone ${counts[s.id]} listings from ${s.name}`}
                style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.75 }]}
              >
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.pickerRowTitle} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={styles.pickerBody}>
                    {counts[s.id]} listing{counts[s.id] === 1 ? '' : 's'} · {s.date}
                  </Text>
                </View>
                {busy === s.id ? (
                  <ActivityIndicator color={TONE.primary} />
                ) : (
                  <Ionicons name="copy-outline" size={20} color={TONE.primary} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...(StyleSheet.absoluteFill as object), backgroundColor: 'rgba(2,6,16,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '82%',
    backgroundColor: '#0C1730',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: TONE.border,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,150,210,0.35)',
    alignSelf: 'center',
  },

  sheetTitle: {
    color: TONE.text,
    fontSize: 17,
    fontFamily: Fonts.sansSemiBold,
    textAlign: 'center',
    paddingTop: Spacing.one,
  },

  row: { flexDirection: 'row', gap: ROW_GAP },
  tile: {
    minHeight: 98,
    borderRadius: 14,
    backgroundColor: TONE.surface,
    borderWidth: 1,
    borderColor: TONE.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 4,
    paddingVertical: Spacing.two,
  },
  tileOff: { opacity: 0.5 },
  tileLabel: { fontSize: 12.5, fontFamily: Fonts.sansSemiBold, textAlign: 'center', lineHeight: 16 },
  tileNote: { color: TONE.faint, fontSize: 9.5, fontFamily: Fonts.sans, textAlign: 'center' },

  pickerTitle: { color: TONE.text, fontSize: 19, fontFamily: Fonts.sansSemiBold, textAlign: 'center' },
  pickerBody: { color: TONE.dim, fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 60 },
  pickerRowTitle: { color: TONE.text, fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
});
