// Show card used by the Home feed and Browse grid.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import type { ShowData } from '@/lib/api';

function formatWhen(show: ShowData) {
  if (show.isLive) return 'LIVE now';
  if (!show.scheduled_time) return 'Schedule TBD';
  const d = new Date(show.scheduled_time);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

export function ShowCard({
  show,
  onPress,
  width,
}: {
  show: ShowData;
  onPress?: () => void;
  width?: number;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={
        onPress ??
        (() => router.push({ pathname: '/show/[id]', params: { id: String(show.id) } }))
      }
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.cardBackground,
          borderColor: c.border,
          opacity: pressed ? 0.85 : 1,
        },
        width ? { width } : null,
      ]}
    >
      <View style={styles.thumbWrap}>
        {show.thumbnail ? (
          <Image
            source={{ uri: show.thumbnail }}
            style={styles.thumb}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={[styles.thumb, { backgroundColor: c.backgroundSelected }]} />
        )}
        {show.isLive && (
          <View style={[styles.liveBadge, { backgroundColor: c.live }]}>
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        )}
      </View>
      <View style={styles.meta}>
        <Text numberOfLines={2} style={[styles.title, { color: c.text }]}>
          {show.name}
        </Text>
        <Text numberOfLines={1} style={[styles.seller, { color: c.textSecondary }]}>
          @{show.seller}
        </Text>
        <Text style={[styles.when, { color: show.isLive ? c.live : c.primary }]}>
          {formatWhen(show)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1, // blue hairline, like the site's dark cards
    overflow: 'hidden',
  },
  thumbWrap: { aspectRatio: 3 / 4 },
  thumb: { width: '100%', height: '100%' },
  liveBadge: {
    position: 'absolute',
    top: Spacing.two,
    left: Spacing.two,
    borderRadius: 6,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  liveText: {
    color: '#fff',
    fontFamily: Fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
  },
  meta: { padding: Spacing.two + Spacing.one, gap: 2 },
  title: { fontSize: 14, fontFamily: Fonts.sansSemiBold, lineHeight: 19 },
  seller: { fontSize: 12, fontFamily: Fonts.sans },
  when: { fontSize: 11, fontFamily: Fonts.mono, letterSpacing: 0.5, marginTop: 2 },
});
