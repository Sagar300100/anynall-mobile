// Followers & following — the signed-in user's own connections, in one place.
// Everyone has this page, buyer or seller: anyone can follow anyone, so both
// lists are first-class. Rows open the person's public profile.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import {
  getFollowCounts,
  listFollowersOf,
  listFollowingOf,
  type PersonRef,
} from '@/lib/follows';
import { useSession } from '@/lib/session';

type Tab = 'followers' | 'following';

export default function ConnectionsScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();
  const { user } = useSession();

  const [tab, setTab] = useState<Tab>('followers');
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  // Each list cached once loaded so tab switches are instant.
  const [followers, setFollowers] = useState<PersonRef[] | null>(null);
  const [following, setFollowing] = useState<PersonRef[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      const uid = user?.uid;
      if (!uid) return;
      let cancelled = false;
      (async () => {
        const [cts, flw, fng] = await Promise.all([
          getFollowCounts(uid),
          listFollowersOf(uid),
          listFollowingOf(uid),
        ]);
        if (cancelled) return;
        setCounts(cts);
        setFollowers(flw);
        setFollowing(fng);
      })();
      return () => {
        cancelled = true;
      };
    }, [user?.uid])
  );

  const list = tab === 'followers' ? followers : following;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Followers & following</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="people-outline"
          title="Sign in to see your connections"
          body="Followers and the people you follow appear here once you're signed in."
          reason="follow"
        />
      ) : (
        <>
          {/* ── Tabs ── */}
          <View style={[styles.tabs, { borderColor: c.border }]}>
            {(
              [
                { key: 'followers' as Tab, label: `Followers (${counts.followers})` },
                { key: 'following' as Tab, label: `Following (${counts.following})` },
              ]
            ).map(({ key, label }) => {
              const active = tab === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: active }}
                  style={styles.tabBtn}
                >
                  <Text
                    style={[
                      styles.tabText,
                      { color: active ? c.text : c.textSecondary },
                      active && { fontFamily: Fonts.sansSemiBold },
                    ]}
                  >
                    {label}
                  </Text>
                  <View
                    style={[
                      styles.tabUnderline,
                      { backgroundColor: active ? c.primary : 'transparent' },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>

          {list === null ? (
            <View style={styles.center}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : list.length === 0 ? (
            <View style={styles.center}>
              <Ionicons
                name={tab === 'followers' ? 'people-outline' : 'person-add-outline'}
                size={34}
                color={c.textFaint}
              />
              <Text style={[styles.emptyTitle, { color: c.text }]}>
                {tab === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
              </Text>
              <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
                {tab === 'followers'
                  ? 'When people follow you, they appear here.'
                  : 'Follow sellers and friends from their profiles or live shows.'}
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
                {list.map((p, i) => (
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
                      accessibilityLabel={`View ${p.name}'s profile`}
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
                          {p.name}
                        </Text>
                        {!!p.username && (
                          <Text style={[styles.rowHandle, { color: c.textFaint }]} numberOfLines={1}>
                            @{p.username}
                          </Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
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

  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  tabBtn: { flex: 1, alignItems: 'center', gap: 7, paddingTop: Spacing.two, minHeight: 44 },
  tabText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
  tabUnderline: { height: 2, alignSelf: 'stretch', borderRadius: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  emptyTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  emptyBody: {
    fontSize: 13.5,
    fontFamily: Fonts.sans,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 300,
  },

  scroll: { padding: Spacing.three, paddingBottom: Spacing.six },
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
  rowHandle: { fontSize: 12, fontFamily: Fonts.sans },
});
