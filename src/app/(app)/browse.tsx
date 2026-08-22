// Explore — search + category filters over the full catalog, PLUS people:
// a search of two or more letters also queries sellers and buyers from the
// shared publicProfiles directory (the same prefix search the website's
// Messages page runs), so one box finds shows AND the people behind them.
// Accepts a `cat` param so Home's category chips land here pre-filtered.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/brand/eyebrow';
import { FadeUp } from '@/components/brand/fade-up';
import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { ShowCard } from '@/components/show-card';
import { useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { useShows } from '@/hooks/use-shows';
import { useIsGuest } from '@/lib/auth-gate';
import { searchUsers, type PublicProfile } from '@/lib/users';

export default function ExploreScreen() {
  const c = useBrandColors();
  const { shows, refreshing, refresh } = useShows();
  // Search is a gated surface (spec §6.2). Tab presses are swallowed by the
  // layout's guest listener, but a deep link (or programmatic push) lands
  // here directly — bounce guests to sign-in on focus. useIsGuest is false
  // while the session is still RESTORING, so members never flash through.
  const isGuest = useIsGuest();
  useFocusEffect(
    useCallback(() => {
      if (isGuest) router.replace({ pathname: '/sign-in', params: { reason: 'search' } });
    }, [isGuest])
  );
  const { cat } = useLocalSearchParams<{ cat?: string }>();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
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
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FadeUp index={0} style={styles.top}>
          <View
            style={[
              styles.searchBox,
              { borderColor: searchFocused ? Brand.authAccent : Brand.hairlineWhite },
            ]}
          >
            <Ionicons
              name="search"
              size={16}
              color={searchFocused ? Brand.authAccent : Brand.slate400}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Shows, sellers, categories…"
              // mistSoft, matching home's search pill placeholder — the
              // hint must be readable, and 40% white wasn't.
              placeholderTextColor={Brand.mistSoft}
              style={[styles.searchInput, { color: c.text }]}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.length > 0 && (
              <PressScale
                onPress={() => setQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={16} color={Brand.slate400} />
              </PressScale>
            )}
          </View>

          {categories.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {categories.map((catName) => {
                  const active = category === catName;
                  return (
                    <PressScale
                      key={catName}
                      onPress={() => setCategory(active ? null : catName)}
                      accessibilityRole="button"
                      accessibilityLabel={`Filter by ${catName}`}
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? Brand.ink600 : 'transparent',
                          borderColor: active ? Brand.blueSky : Brand.hairline,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? Brand.blueSky : Brand.slate400 },
                        ]}
                      >
                        {catName}
                      </Text>
                    </PressScale>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </FadeUp>

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
                <Eyebrow style={styles.peopleLabel}>People</Eyebrow>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.peopleRow}>
                    {people.map((p) => (
                      <PressScale
                        key={p.uid}
                        onPress={() =>
                          router.push({
                            pathname: '/user/[username]',
                            params: { username: p.username || p.uid, uid: p.uid },
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`View ${p.displayName}'s profile`}
                        style={styles.personCard}
                      >
                        {p.photoURL ? (
                          <Image source={{ uri: p.photoURL }} style={styles.personAvatar} contentFit="cover" />
                        ) : (
                          <View style={[styles.personAvatar, styles.personAvatarEmpty, { borderColor: Brand.hairlineWhite }]}>
                            <Ionicons name="person-outline" size={16} color={Brand.slate400} />
                          </View>
                        )}
                        <Text style={[styles.personName, { color: c.text }]} numberOfLines={1}>
                          {p.displayName}
                        </Text>
                        <Text style={[styles.personMeta, { color: Brand.mistFaint }]} numberOfLines={1}>
                          {p.username ? `@${p.username}` : p.isSeller ? 'Seller' : ''}
                        </Text>
                      </PressScale>
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
              <Ionicons name="compass-outline" size={40} color={Brand.blueSky} />
              <Text style={[styles.emptyTitle, { color: c.text }]}>Nothing matches</Text>
              <Text style={[styles.emptyBody, { color: Brand.slate400 }]}>
                Try a different search{category ? ' or clear the category filter' : ''}.
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Brand.blueSky} />
          }
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
  safe: { flex: 1 },
  top: { padding: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two + Spacing.one },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: Spacing.three,
    paddingVertical: 2,
  },
  searchInput: { flex: 1, fontSize: 15.5, fontFamily: Fonts.ui, paddingVertical: 11 },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontFamily: Fonts.uiSemiBold },
  listContent: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  gridRow: { gap: Spacing.three },
  gridItem: { flex: 1 },
  peopleWrap: { gap: Spacing.two, marginBottom: Spacing.one },
  peopleLabel: { marginLeft: 2 },
  peopleRow: { flexDirection: 'row', gap: Spacing.two },
  personCard: {
    width: 108,
    borderWidth: 1,
    borderRadius: 16,
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: Spacing.two + Spacing.one,
    alignItems: 'center',
    gap: 4,
  },
  personAvatar: { width: 44, height: 44, borderRadius: 22 },
  personAvatarEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  personName: { fontSize: 12.5, fontFamily: Fonts.uiSemiBold, maxWidth: '100%' },
  personMeta: { fontSize: 10.5, fontFamily: Fonts.ui, maxWidth: '100%' },
  empty: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  emptyTitle: { fontSize: 20, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  emptyBody: { fontSize: 14, fontFamily: Fonts.ui, textAlign: 'center' },
});
