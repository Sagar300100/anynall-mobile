// Followers & following — the signed-in user's own connections, in one place.
// Everyone has this page, buyer or seller: anyone can follow anyone, so both
// lists are first-class. Rows open the person's public profile.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, Spacing } from '@/constants/theme';
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
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <PressScale
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </PressScale>
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
          <View style={[styles.tabs, { borderColor: Brand.hairlineWhite }]}>
            {(
              [
                { key: 'followers' as Tab, label: `Followers (${counts.followers})` },
                { key: 'following' as Tab, label: `Following (${counts.following})` },
              ]
            ).map(({ key, label }) => {
              const active = tab === key;
              return (
                <PressScale
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
                      active && { fontFamily: Fonts.uiSemiBold },
                    ]}
                  >
                    {label}
                  </Text>
                  <View
                    style={[
                      styles.tabUnderline,
                      { backgroundColor: active ? Brand.blueSky : 'transparent' },
                    ]}
                  />
                </PressScale>
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
              <View style={styles.group}>
                {list.map((p, i) => (
                  <View key={p.uid}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: Brand.hairlineWhite }]} />}
                    <PressScale
                      onPress={() =>
                        router.push({
                          pathname: '/user/[username]',
                          params: { username: p.username || p.uid, uid: p.uid },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`View ${p.name}'s profile`}
                      style={styles.row}
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
                    </PressScale>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </>
      )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
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
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },

  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  tabBtn: { flex: 1, alignItems: 'center', gap: 7, paddingTop: Spacing.two, minHeight: 44 },
  tabText: { fontSize: 13.5, fontFamily: Fonts.uiMedium },
  tabUnderline: { height: 2, alignSelf: 'stretch', borderRadius: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  emptyTitle: { fontSize: 16, fontFamily: Fonts.uiSemiBold },
  emptyBody: {
    fontSize: 13.5,
    fontFamily: Fonts.ui,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 300,
  },

  scroll: { padding: Spacing.three, paddingBottom: Spacing.six },
  group: {
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    overflow: 'hidden',
  },
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
  rowName: { fontSize: 14.5, fontFamily: Fonts.uiMedium },
  rowHandle: { fontSize: 12, fontFamily: Fonts.ui },
});
