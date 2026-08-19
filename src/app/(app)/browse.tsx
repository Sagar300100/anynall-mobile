// Explore — search + category filters over the full catalog, PLUS people:
// a search of two or more letters also queries sellers and buyers from the
// shared publicProfiles directory (the same prefix search the website's
// Messages page runs), so one box finds shows AND the people behind them.
// Accepts a `cat` param so Home's category chips land here pre-filtered.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Fonts, Spacing } from '@/constants/theme';
import { useShows } from '@/hooks/use-shows';
import { searchUsers, type PublicProfile } from '@/lib/users';

export default function ExploreScreen() {
  const c = useBrandColors();
  const { shows, refreshing, refresh } = useShows();
  const { cat } = useLocalSearchParams<{ cat?: string }>();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // People results, debounced — same publicProfiles prefix search as the web.
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const peopleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (peopleTimer.current) clearTimeout(peopleTimer.current);
    const term = query.trim();
    if (term.length < 2) {
      peopleTimer.current = setTimeout(() => setPeople([]), 0);
    } else {
      peopleTimer.current = setTimeout(async () => {
        setPeople(await searchUsers(term, 6));
      }, 300);
    }
    return () => {
      if (peopleTimer.current) clearTimeout(peopleTimer.current);
    };
  }, [query]);

  // Home's category chips deep-link here.
  useEffect(() => {
    if (cat) setCategory(String(cat));
  }, [cat]);

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
      <View style={styles.top}>
        <View
          style={[styles.searchBox, { backgroundColor: c.backgroundElement, borderColor: c.border }]}
        >
          <Ionicons name="search" size={16} color={c.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Shows, sellers, categories…"
            placeholderTextColor={c.textFaint}
            style={[styles.searchInput, { color: c.text }]}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={c.textSecondary} />
            </Pressable>
          )}
        </View>

        {categories.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {categories.map((catName) => {
                const active = category === catName;
                return (
                  <Pressable
                    key={catName}
                    onPress={() => setCategory(active ? null : catName)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? c.backgroundSelected : 'transparent',
                        borderColor: active ? c.primary : c.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? c.primary : c.textSecondary },
                      ]}
                    >
                      {catName}
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
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          people.length > 0 ? (
            <View style={styles.peopleWrap}>
              <Text style={[styles.peopleLabel, { color: c.primary }]}>PEOPLE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.peopleRow}>
                  {people.map((p) => (
                    <Pressable
                      key={p.uid}
                      onPress={() =>
                        router.push({
                          pathname: '/user/[username]',
                          params: { username: p.username || p.uid, uid: p.uid },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`View ${p.displayName}'s profile`}
                      style={({ pressed }) => [
                        styles.personCard,
                        { backgroundColor: c.cardBackground, borderColor: c.border },
                        pressed && { opacity: 0.75 },
                      ]}
                    >
                      {p.photoURL ? (
                        <Image source={{ uri: p.photoURL }} style={styles.personAvatar} contentFit="cover" />
                      ) : (
                        <View style={[styles.personAvatar, styles.personAvatarEmpty, { borderColor: c.border }]}>
                          <Ionicons name="person-outline" size={16} color={c.textSecondary} />
                        </View>
                      )}
                      <Text style={[styles.personName, { color: c.text }]} numberOfLines={1}>
                        {p.displayName}
                      </Text>
                      <Text style={[styles.personMeta, { color: c.textFaint }]} numberOfLines={1}>
                        {p.username ? `@${p.username}` : p.isSeller ? 'Seller' : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.gridItem}>
            <ShowCard show={item} />
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="compass-outline" size={40} color={c.primary} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>Nothing matches</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
              Try a different search{category ? ' or clear the category filter' : ''}.
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
  top: { padding: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two + Spacing.one },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 2,
  },
  searchInput: { flex: 1, fontSize: 15.5, fontFamily: Fonts.sans, paddingVertical: 11 },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontFamily: Fonts.sansMedium },
  listContent: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  gridRow: { gap: Spacing.three },
  gridItem: { flex: 1 },
  peopleWrap: { gap: Spacing.two, marginBottom: Spacing.one },
  peopleLabel: { fontFamily: Fonts.mono, fontSize: 10.5, letterSpacing: 1.8, marginLeft: 2 },
  peopleRow: { flexDirection: 'row', gap: Spacing.two },
  personCard: {
    width: 108,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.two + Spacing.one,
    alignItems: 'center',
    gap: 4,
  },
  personAvatar: { width: 44, height: 44, borderRadius: 22 },
  personAvatarEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  personName: { fontSize: 12.5, fontFamily: Fonts.sansMedium, maxWidth: '100%' },
  personMeta: { fontSize: 10.5, fontFamily: Fonts.sans, maxWidth: '100%' },
  empty: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  emptyTitle: { fontSize: 17, fontFamily: Fonts.sansSemiBold },
  emptyBody: { fontSize: 14, fontFamily: Fonts.sans, textAlign: 'center' },
});
