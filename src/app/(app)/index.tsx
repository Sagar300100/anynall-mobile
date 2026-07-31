import { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ShowCard } from '@/components/show-card';
import { DisplayText, Eyebrow, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useShows } from '@/hooks/use-shows';
import type { ShowData } from '@/lib/api';

export default function HomeScreen() {
  const c = useBrandColors();
  const { live, upcoming, replays, loading, refreshing, error, refresh } = useShows();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(200, width * 0.44);

  // Upcoming is the vertical backbone; Live and Replays ride in the header.
  const gridData = useMemo(() => upcoming, [upcoming]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.primary} />
      </SafeAreaView>
    );
  }

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.brandBlock}>
        <Eyebrow>Live shopping · India</Eyebrow>
        <DisplayText size={34}>The marketplace, live.</DisplayText>
      </View>

      {!!error && (
        <Text style={[styles.error, { color: c.danger }]}>{error}</Text>
      )}

      {live.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <View style={[styles.liveDot, { backgroundColor: c.live }]} />
            <Text style={[styles.sectionTitle, { color: c.text }]}>Live now</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.hRow}>
              {live.map((s: ShowData) => (
                <ShowCard key={String(s.id)} show={s} width={cardWidth} />
              ))}
            </View>
          </ScrollView>
        </>
      )}

      {replays.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Replays</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.hRow}>
              {replays.map((s: ShowData) => (
                <ShowCard key={String(s.id)} show={s} width={cardWidth} />
              ))}
            </View>
          </ScrollView>
        </>
      )}

      {gridData.length > 0 && (
        <Text style={[styles.sectionTitle, { color: c.text }]}>Coming up</Text>
      )}
    </View>
  );

  const empty = (
    <View style={[styles.center, { paddingVertical: Spacing.six }]}>
      <Text style={[styles.emptyTitle, { color: c.text }]}>No shows yet</Text>
      <Text style={{ color: c.textSecondary, textAlign: 'center' }}>
        When sellers schedule shows, they&apos;ll appear here. Pull to refresh.
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <FlatList
        data={gridData}
        keyExtractor={(s) => String(s.id)}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        ListEmptyComponent={live.length === 0 && replays.length === 0 ? empty : null}
        renderItem={({ item }) => (
          <View style={styles.gridItem}>
            <ShowCard show={item} />
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  headerWrap: { gap: Spacing.three, paddingBottom: Spacing.two },
  brandBlock: { gap: Spacing.one + 2, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 22, fontFamily: Fonts.display },
  hRow: { flexDirection: 'row', gap: Spacing.three },
  listContent: { padding: Spacing.three, gap: Spacing.three },
  gridRow: { gap: Spacing.three },
  gridItem: { flex: 1 },
  error: { fontSize: 14, fontFamily: Fonts.sans },
  emptyTitle: { fontSize: 22, fontFamily: Fonts.display },
});
