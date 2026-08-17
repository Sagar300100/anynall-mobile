// All Categories — opened from the homepage rail's "All Categories" tile and
// the "Browse more categories" See-all action.
//
// Content is the approved category source (lib/categories); visuals are the
// approved local artwork (lib/category-art) with a controlled icon fallback.
// Ordering: "Featured" = the approved source order (not labelled as
// personalised — no recommendation system exists) and "A–Z". There is
// deliberately NO "Popular" control and NO viewer counts: the backend has no
// popularity/analytics source.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { categoryArtwork, categoryIcon } from '@/lib/category-art';
import { CATEGORIES } from '@/lib/categories';

const NUM_COLUMNS = 4;
// Matches the navy field baked into the blue category-artwork crops.
const ART_BG = '#010F27';

type SortMode = 'featured' | 'az';

export default function CategoriesScreen() {
  const c = useBrandColors();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortMode>('featured');

  const tileWidth = Math.floor(
    (width - Spacing.three * 2 - Spacing.two * (NUM_COLUMNS - 1)) / NUM_COLUMNS
  );

  const data = useMemo(() => {
    const ordered = sort === 'az' ? [...CATEGORIES].sort((a, b) => a.localeCompare(b)) : [...CATEGORIES];
    const needle = q.trim().toLowerCase();
    return needle ? ordered.filter((cat) => cat.toLowerCase().includes(needle)) : ordered;
  }, [q, sort]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Categories</Text>
      </View>

      <View style={[styles.searchBar, { backgroundColor: c.cardBackground, borderColor: c.borderStrong }]}>
        <Ionicons name="search-outline" size={18} color={c.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search categories"
          placeholderTextColor={c.textFaint}
          accessibilityLabel="Search categories"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.searchInput, { color: c.text }]}
        />
        {q.length > 0 && (
          <Pressable
            onPress={() => setQ('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color={c.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Ordering — real behaviour only: approved order or alphabetical. */}
      <View style={styles.sortRow}>
        {(
          [
            ['featured', 'Featured'],
            ['az', 'A–Z'],
          ] as const
        ).map(([mode, label]) => {
          const selected = sort === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => setSort(mode)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Sort: ${label}`}
              style={({ pressed }) => [
                styles.sortChip,
                { borderColor: selected ? c.primary : c.border },
                selected && { backgroundColor: 'rgba(74,143,229,0.14)' },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.sortChipText, { color: selected ? c.primary : c.textSecondary }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item: string) => item}
        numColumns={NUM_COLUMNS}
        columnWrapperStyle={styles.gridRow}
        // Generous bottom clearance so the last row always sits fully above
        // the tab bar, on gesture and 3-button navigation alike.
        contentContainerStyle={[styles.grid, { paddingBottom: Spacing.five + insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const art = categoryArtwork(item);
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/browse', params: { cat: item } })}
              accessibilityRole="button"
              accessibilityLabel={`Browse ${item}`}
              style={({ pressed }) => [styles.tile, { width: tileWidth }, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.tileArtWrap, { borderColor: c.border, backgroundColor: ART_BG }]}>
                {art ? (
                  <Image source={art} style={styles.tileArt} contentFit="contain" transition={120} />
                ) : (
                  // Controlled fallback: dark tile + one line icon, never a stock photo.
                  <Ionicons name={categoryIcon(item)} size={20} color={c.primary} />
                )}
              </View>
              <Text numberOfLines={2} style={[styles.tileLabel, { color: c.text }]}>
                {item}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={30} color={c.textSecondary} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>No categories found</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>Try a different search.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { fontSize: 19, fontFamily: Fonts.sansSemiBold },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.two + Spacing.one,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: Fonts.sans, paddingVertical: 10 },
  sortRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    // Clear separation before the grid — the first row must never feel like
    // it's emerging from underneath the pills.
    paddingBottom: Spacing.three,
  },
  sortChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 7,
    minHeight: 34,
    justifyContent: 'center',
  },
  sortChipText: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
  grid: {
    paddingHorizontal: Spacing.three,
    paddingTop: 2,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  gridRow: { gap: Spacing.two },
  tile: { gap: 6 },
  tileArtWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Contained with internal padding; the assets' feathered edges blend into
  // the card background, so the object floats — no square frame, no cropping.
  tileArt: { width: '88%', height: '88%' },
  tileLabel: {
    fontSize: 10.5,
    fontFamily: Fonts.sansMedium,
    textAlign: 'center',
    lineHeight: 14,
    // Fixed two-line space so 1-line and 2-line names align across a row.
    minHeight: 28,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingTop: Spacing.five,
    paddingHorizontal: Spacing.five,
  },
  emptyTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  emptyBody: { fontSize: 13.5, fontFamily: Fonts.sans },
});
