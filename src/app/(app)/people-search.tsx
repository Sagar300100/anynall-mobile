// People search — the audit's "no way to find a person" gap. Ports the
// website's Messages-page user search: username + display-name prefix
// queries over publicProfiles (lib/users.searchUsers — the exact queries
// already proven on web). Rows open the person's public profile, where
// Follow and Message (with the request flow) live.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import { searchUsers, type PublicProfile } from '@/lib/users';

const DEBOUNCE_MS = 350;

export default function PeopleSearchScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicProfile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = query.trim();
    // All state writes go through the timer — never synchronously in the
    // effect body (the compiler flags that as a cascading render).
    if (term.length < 2) {
      timer.current = setTimeout(() => {
        setResults(null);
        setSearching(false);
      }, 0);
    } else {
      timer.current = setTimeout(async () => {
        setSearching(true);
        const found = await searchUsers(term);
        setResults(found);
        setSearching(false);
      }, DEBOUNCE_MS);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/inbox'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Find people</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="search-outline"
          title="Sign in to find people"
          body="Search sellers and buyers by name or @handle, then follow or message them."
          reason="chat"
        />
      ) : (
        <>
          <View style={styles.searchWrap}>
            <View
              style={[styles.search, { backgroundColor: c.backgroundElement, borderColor: c.border }]}
            >
              <Ionicons name="search-outline" size={17} color={c.textSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name or @handle"
                placeholderTextColor={c.textFaint}
                accessibilityLabel="Search people by name or handle"
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={[styles.searchInput, { color: c.text }]}
              />
              {!!query && (
                <Pressable
                  onPress={() => setQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={17} color={c.textFaint} />
                </Pressable>
              )}
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
          >
            {query.trim().length < 2 ? (
              <View style={styles.hintWrap}>
                <Ionicons name="people-outline" size={30} color={c.textFaint} />
                <Text style={[styles.hint, { color: c.textSecondary }]}>
                  Type at least two letters to search sellers and buyers across Any&All.
                </Text>
              </View>
            ) : searching && results === null ? (
              <ActivityIndicator color={c.primary} style={styles.loading} />
            ) : results !== null && results.length === 0 ? (
              <View style={styles.hintWrap}>
                <Text style={[styles.emptyTitle, { color: c.text }]}>Nobody found</Text>
                <Text style={[styles.hint, { color: c.textSecondary }]}>
                  Check the spelling — handles are matched from the start of the name.
                </Text>
              </View>
            ) : (
              <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
                {(results || []).map((p, i) => (
                  <View key={p.uid}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/user/[username]',
                          params: { username: p.username || p.uid, uid: p.uid },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`View ${p.displayName}'s profile`}
                      style={({ pressed }) => [
                        styles.row,
                        pressed && { backgroundColor: 'rgba(120,150,210,0.07)' },
                      ]}
                    >
                      {p.photoURL ? (
                        <Image source={{ uri: p.photoURL }} style={styles.avatar} contentFit="cover" />
                      ) : (
                        <View style={[styles.avatar, styles.avatarEmpty, { borderColor: c.border }]}>
                          <Ionicons name="person-outline" size={16} color={c.textSecondary} />
                        </View>
                      )}
                      <View style={styles.rowText}>
                        <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>
                          {p.displayName}
                        </Text>
                        <Text style={[styles.rowMeta, { color: c.textFaint }]} numberOfLines={1}>
                          {p.username ? `@${p.username}` : ''}
                          {p.isSeller ? (p.username ? ' · Seller' : 'Seller') : ''}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </>
      )}
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
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.sansSemiBold },

  searchWrap: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 15, fontFamily: Fonts.sans },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, paddingBottom: 90 },
  loading: { paddingVertical: Spacing.five },
  hintWrap: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  hint: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  emptyTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },

  group: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    minHeight: 60,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 1 },
  rowName: { fontSize: 14.5, fontFamily: Fonts.sansMedium },
  rowMeta: { fontSize: 12, fontFamily: Fonts.sans },
});
