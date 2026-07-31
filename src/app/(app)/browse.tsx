import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ShowCard } from '@/components/show-card';
import { useBrandColors } from '@/components/ui/form';
import { Spacing } from '@/constants/theme';
import { useShows } from '@/hooks/use-shows';

export default function BrowseScreen() {
  const c = useBrandColors();
  const { shows, refreshing, refresh } = useShows();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(
    () =>
      [...new Set(shows.map((s) => s.category).filter((v) => v && v !== 'Uncategorized'))].sort(),
    [shows]
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shows.filter((s) => {
      if (category && s.category !== category) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.seller.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [shows, query, category]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search shows, sellers, categories…"
          placeholderTextColor={c.textSecondary}
          style={[
            styles.search,
            { color: c.text, backgroundColor: c.cardBackground, borderColor: c.border },
          ]}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {categories.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {categories.map((cat) => {
                const active = category === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setCategory(active ? null : cat)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? c.primary : c.cardBackground,
                        borderColor: active ? c.primary : c.border,
                      },
                    ]}
                  >
                    <Text style={{ color: active ? '#fff' : c.text, fontWeight: '600', fontSize: 13 }}>
                      {cat}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        )}
      </View>

      <FlatList
        data={results}
        keyExtractor={(s) => String(s.id)}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.gridItem}>
            <ShowCard show={item} />
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: c.textSecondary, textAlign: 'center' }}>
              No shows match your search.
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  searchWrap: { padding: Spacing.three, gap: Spacing.two + Spacing.one },
  search: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 16,
  },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  listContent: { padding: Spacing.three, gap: Spacing.three },
  gridRow: { gap: Spacing.three },
  gridItem: { flex: 1 },
  empty: { paddingVertical: Spacing.six },
});
