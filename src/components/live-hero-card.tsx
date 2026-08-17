// Full-width live show card — the lead unit on Home and the building block of
// the Live tab. Image-led with a bottom scrim; the show's own thumbnail
// carries the visual energy, chrome stays minimal.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import type { ShowData } from '@/lib/api';

function scheduleLabel(show: ShowData) {
  if (show.isLive) return null;
  if (!show.scheduled_time) return 'Scheduled';
  const d = new Date(show.scheduled_time);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today · ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`;
}

export function LiveHeroCard({
  show,
  height = 240,
}: {
  show: ShowData;
  height?: number;
}) {
  const c = useBrandColors();
  const when = scheduleLabel(show);

  function open() {
    if (show.isLive) {
      router.push({ pathname: '/live/[id]', params: { id: String(show.id) } });
    } else {
      router.push({ pathname: '/show/[id]', params: { id: String(show.id) } });
    }
  }

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [
        styles.card,
        { height, borderColor: c.border, opacity: pressed ? 0.92 : 1 },
      ]}
    >
      {show.thumbnail ? (
        <Image source={{ uri: show.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.backgroundSelected }]} />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(3,7,18,0.55)', 'rgba(3,7,18,0.92)']}
        locations={[0.35, 0.65, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Status chip */}
      <View style={styles.topRow}>
        {show.isLive ? (
          <View style={[styles.liveChip, { backgroundColor: c.live }]}>
            <View style={styles.liveDot} />
            <Text style={styles.liveChipText}>LIVE</Text>
          </View>
        ) : (
          !!when && (
            <View style={styles.whenChip}>
              <Ionicons name="time-outline" size={12} color="#FFFFFF" />
              <Text style={styles.whenChipText}>{when}</Text>
            </View>
          )
        )}
      </View>

      {/* Bottom info + action */}
      <View style={styles.bottom}>
        <View style={styles.info}>
          <Text numberOfLines={2} style={styles.title}>
            {show.name}
          </Text>
          <Text numberOfLines={1} style={styles.seller}>
            @{show.seller}
            {show.category && show.category !== 'Uncategorized' ? `  ·  ${show.category}` : ''}
          </Text>
        </View>
        <View style={[styles.cta, { backgroundColor: show.isLive ? '#FFFFFF' : 'rgba(255,255,255,0.16)' }]}>
          <Text style={[styles.ctaText, { color: show.isLive ? '#0B1F3F' : '#FFFFFF' }]}>
            {show.isLive ? 'Join' : 'Details'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  topRow: {
    position: 'absolute',
    top: Spacing.two + Spacing.one,
    left: Spacing.two + Spacing.one,
    flexDirection: 'row',
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 6,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  liveChipText: { color: '#FFFFFF', fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5 },
  whenChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 6,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    backgroundColor: 'rgba(3,7,18,0.6)',
  },
  whenChipText: { color: '#FFFFFF', fontFamily: Fonts.sansMedium, fontSize: 11 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.three,
  },
  info: { flex: 1, gap: 3 },
  title: { color: '#FFFFFF', fontSize: 17, fontFamily: Fonts.sansSemiBold, lineHeight: 22 },
  seller: { color: 'rgba(255,255,255,0.75)', fontSize: 12.5, fontFamily: Fonts.sans },
  cta: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three + Spacing.one,
    paddingVertical: 9,
  },
  ctaText: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
});
