// Public profile — mobile port of the website's pages/UserProfilePage.tsx.
//
// Route: /user/[username], with an optional ?uid= param so places that
// already know the uid (live room, show page) skip the usernames/{handle}
// lookup. Data model is identical to the web:
//
//   publicProfiles/{uid}  — displayName, username, photo, bio, isPrivate,
//                           isSeller, interests (NEVER users/{uid}, which
//                           holds KYC/PII and is owner-read-only)
//   follows               — aggregation counts + Instagram-style status
//   shows                 — the seller's shows, filtered by ownerUid
//
// PRODUCT DECISION: there are no private accounts — every profile is fully
// visible and anyone can follow anyone (buyer or seller). The Follow button
// has two states: Follow / Following. Messaging goes through a message
// request the other person accepts first (see lib/conversations.ts).
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ShowCard } from '@/components/show-card';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import type { ShowData } from '@/lib/api';
import { useAuthGate } from '@/lib/auth-gate';
import { getOrCreateDirectConversation } from '@/lib/conversations';
import {
  followUser,
  getFollowCounts,
  getFollowStatus,
  listFollowersOf,
  listFollowingOf,
  unfollow,
  type FollowStatus,
  type PersonRef,
} from '@/lib/follows';
import { useSession } from '@/lib/session';
import { fsFetchShows } from '@/lib/shows';
import { getPublicProfile, lookupUidByUsername, type PublicProfile } from '@/lib/users';

function joinedLabel(ms?: number): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return `Joined ${d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`;
}

type PeopleTab = 'following' | 'followers' | null;

export default function PublicProfileScreen() {
  const c = useBrandColors();
  const { user } = useSession();
  const requireAuth = useAuthGate();
  const { username, uid: uidParam } = useLocalSearchParams<{ username?: string; uid?: string }>();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  const [status, setStatus] = useState<FollowStatus>('none');
  const [followBusy, setFollowBusy] = useState(false);
  const [shows, setShows] = useState<ShowData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);

  // People lists load lazily, only when their tab is opened.
  const [peopleTab, setPeopleTab] = useState<PeopleTab>(null);
  const [people, setPeople] = useState<PersonRef[] | null>(null);

  const isOwner = !!profile && profile.uid === user?.uid;

  const load = useCallback(async () => {
    setError(null);
    // Prefer the passed uid (live room / show page know it); fall back to the
    // public usernames/{handle} map.
    const uid = uidParam || (username ? await lookupUidByUsername(username) : null);
    if (!uid) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const [p, cts, st] = await Promise.all([
      getPublicProfile(uid),
      getFollowCounts(uid),
      user ? getFollowStatus(uid) : Promise.resolve<FollowStatus>('none'),
    ]);
    if (!p) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setProfile(p);
    setCounts(cts);
    setStatus(st);
    setLoading(false);
    // Seller shows load after the header is already on screen.
    if (p.isSeller) {
      try {
        const all = await fsFetchShows();
        setShows(all.filter((s) => s.ownerUid === uid));
      } catch {
        /* shows stay empty — the section simply doesn't render */
      }
    }
  }, [uidParam, username, user]);

  // Refetch on focus so a follow made elsewhere is reflected on return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleFollowPress() {
    if (!profile || followBusy) return;
    requireAuth('follow', async () => {
      setFollowBusy(true);
      setError(null);
      try {
        if (status === 'following') {
          await unfollow(profile.uid);
          setStatus('none');
          setCounts((v) => ({ ...v, followers: Math.max(0, v.followers - 1) }));
        } else {
          await followUser(profile.uid);
          setStatus('following');
          setCounts((v) => ({ ...v, followers: v.followers + 1 }));
        }
      } catch {
        setError('Couldn’t update follow — please try again.');
      } finally {
        setFollowBusy(false);
      }
    });
  }

  function handleMessagePress() {
    if (!profile || messaging) return;
    requireAuth('chat', async () => {
      setMessaging(true);
      try {
        const id = await getOrCreateDirectConversation(profile.uid, {
          displayName: profile.displayName,
          username: profile.username,
          photoURL: profile.photoURL,
        });
        router.push({
          pathname: '/chat/[id]',
          params: { id, otherUid: profile.uid, otherName: profile.displayName },
        });
      } catch {
        setError('Couldn’t open the conversation — please try again.');
      } finally {
        setMessaging(false);
      }
    });
  }

  async function openPeople(tab: Exclude<PeopleTab, null>) {
    if (!profile) return;
    if (peopleTab === tab) {
      setPeopleTab(null); // toggle closed
      return;
    }
    setPeopleTab(tab);
    setPeople(null);
    const list =
      tab === 'following' ? await listFollowingOf(profile.uid) : await listFollowersOf(profile.uid);
    setPeople(list);
  }

  const liveShows = shows.filter((s) => s.isLive);
  const upcomingShows = shows.filter((s) => !s.isLive);

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
        <Text style={[styles.topTitle, { color: c.text }]} numberOfLines={1}>
          {profile ? `@${profile.username || profile.displayName}` : 'Profile'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : notFound ? (
        <View style={styles.center}>
          <Ionicons name="person-circle-outline" size={40} color={c.textFaint} />
          <Text style={[styles.body, { color: c.textSecondary }]}>
            This profile doesn’t exist or isn’t available.
          </Text>
        </View>
      ) : profile ? (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* ── Header ── */}
          <View style={styles.header}>
            {profile.photoURL ? (
              <Image source={{ uri: profile.photoURL }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty, { borderColor: c.border }]}>
                <Ionicons name="person-outline" size={30} color={c.textSecondary} />
              </View>
            )}
            <View style={styles.headerText}>
              <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                {profile.displayName}
              </Text>
              {!!profile.username && (
                <Text style={[styles.handle, { color: c.textSecondary }]} numberOfLines={1}>
                  @{profile.username}
                </Text>
              )}
              <View style={styles.badges}>
                {profile.isSeller && (
                  <View style={[styles.roleBadge, { borderColor: 'rgba(74,143,229,0.4)' }]}>
                    <Ionicons name="storefront-outline" size={11} color={c.primary} />
                    <Text style={[styles.roleBadgeText, { color: c.primary }]}>Seller</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* ── Counts ── */}
          <View style={styles.counts}>
            <CountCell label="Followers" value={counts.followers} onPress={() => openPeople('followers')} active={peopleTab === 'followers'} />
            <View style={[styles.countDivider, { backgroundColor: c.border }]} />
            <CountCell label="Following" value={counts.following} onPress={() => openPeople('following')} active={peopleTab === 'following'} />
          </View>

          {/* ── Actions ── */}
          {!isOwner && (
            <View style={styles.actions}>
              <Pressable
                onPress={handleFollowPress}
                disabled={followBusy}
                accessibilityRole="button"
                accessibilityLabel={status === 'following' ? 'Unfollow' : 'Follow'}
                accessibilityState={{ disabled: followBusy, selected: status !== 'none' }}
                style={({ pressed }) => [
                  styles.followBtn,
                  status === 'none'
                    ? { backgroundColor: c.cta }
                    : { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.borderStrong },
                  { opacity: pressed || followBusy ? 0.75 : 1 },
                ]}
              >
                {followBusy ? (
                  <ActivityIndicator size="small" color={status === 'none' ? c.ctaText : c.text} />
                ) : (
                  <Text
                    style={[styles.followBtnText, { color: status === 'none' ? c.ctaText : c.text }]}
                  >
                    {status === 'following' ? 'Following' : 'Follow'}
                  </Text>
                )}
              </Pressable>
              <Pressable
                onPress={handleMessagePress}
                disabled={messaging}
                accessibilityRole="button"
                accessibilityLabel={`Message ${profile.displayName}`}
                style={({ pressed }) => [
                  styles.msgBtn,
                  { borderColor: c.borderStrong, opacity: pressed || messaging ? 0.7 : 1 },
                ]}
              >
                {messaging ? (
                  <ActivityIndicator size="small" color={c.text} />
                ) : (
                  <Ionicons name="chatbubble-outline" size={17} color={c.text} />
                )}
              </Pressable>
            </View>
          )}

          {!!error && <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>}

          <>
              {/* ── People list (lazy) ── */}
              {peopleTab && (
                <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
                  <Text style={[styles.cardTitle, { color: c.text }]}>
                    {peopleTab === 'followers' ? 'Followers' : 'Following'}
                  </Text>
                  {people === null ? (
                    <ActivityIndicator color={c.primary} style={styles.peopleLoading} />
                  ) : people.length === 0 ? (
                    <Text style={[styles.body, { color: c.textFaint }]}>
                      {peopleTab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
                    </Text>
                  ) : (
                    people.map((p) => (
                      <Pressable
                        key={p.uid}
                        onPress={() =>
                          router.push({
                            pathname: '/user/[username]',
                            params: { username: p.username || p.uid, uid: p.uid },
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`View ${p.name}'s profile`}
                        style={({ pressed }) => [styles.personRow, pressed && { opacity: 0.7 }]}
                      >
                        {p.photoURL ? (
                          <Image source={{ uri: p.photoURL }} style={styles.personAvatar} contentFit="cover" />
                        ) : (
                          <View style={[styles.personAvatar, styles.avatarEmpty, { borderColor: c.border }]}>
                            <Ionicons name="person-outline" size={14} color={c.textSecondary} />
                          </View>
                        )}
                        <View style={styles.personText}>
                          <Text style={[styles.personName, { color: c.text }]} numberOfLines={1}>
                            {p.name}
                          </Text>
                          {!!p.username && (
                            <Text style={[styles.personHandle, { color: c.textFaint }]} numberOfLines={1}>
                              @{p.username}
                            </Text>
                          )}
                        </View>
                        <Ionicons name="chevron-forward" size={15} color={c.textFaint} />
                      </Pressable>
                    ))
                  )}
                </View>
              )}

              {/* ── About ── */}
              <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
                <Text style={[styles.cardTitle, { color: c.text }]}>About</Text>
                <Text style={[styles.body, { color: profile.bio ? c.textSecondary : c.textFaint }]}>
                  {profile.bio ||
                    (isOwner
                      ? 'This is your bio. Add a few lines about yourself on anynall.com so others can know you better.'
                      : 'No bio yet.')}
                </Text>
                {profile.interests.length > 0 && (
                  <View style={styles.interests}>
                    {profile.interests.map((tag) => (
                      <View key={tag} style={[styles.interestChip, { borderColor: c.border }]}>
                        <Text style={[styles.interestText, { color: c.textSecondary }]}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {!!joinedLabel(profile.createdAtMs) && (
                  <Text style={[styles.joined, { color: c.textFaint }]}>
                    {joinedLabel(profile.createdAtMs)}
                  </Text>
                )}
              </View>

              {/* ── Seller shows ── */}
              {profile.isSeller && (liveShows.length > 0 || upcomingShows.length > 0) && (
                <>
                  {liveShows.length > 0 && (
                    <View style={styles.showsSection}>
                      <Text style={[styles.sectionTitle, { color: '#E63946' }]}>LIVE NOW</Text>
                      <View style={styles.showsGrid}>
                        {liveShows.map((s) => (
                          <ShowCard key={String(s.id)} show={s} width={GRID_CARD_WIDTH} />
                        ))}
                      </View>
                    </View>
                  )}
                  {upcomingShows.length > 0 && (
                    <View style={styles.showsSection}>
                      <Text style={[styles.sectionTitle, { color: c.primary }]}>SHOWS</Text>
                      <View style={styles.showsGrid}>
                        {upcomingShows.map((s) => (
                          <ShowCard key={String(s.id)} show={s} width={GRID_CARD_WIDTH} />
                        ))}
                      </View>
                    </View>
                  )}
                </>
              )}
          </>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function CountCell({
  label,
  value,
  onPress,
  active,
}: {
  label: string;
  value: number;
  onPress: () => void;
  active: boolean;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      accessibilityState={{ expanded: active }}
      style={({ pressed }) => [styles.countCell, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.countValue, { color: c.text }]}>{value}</Text>
      <Text style={[styles.countLabel, { color: active ? c.primary : c.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// Two-up grid with the screen's horizontal padding and gap accounted for.
const GRID_CARD_WIDTH = (Dimensions.get('window').width - Spacing.three * 2 - Spacing.two) / 2;

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
  topTitle: { flex: 1, fontSize: 17, fontFamily: Fonts.sansSemiBold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  body: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 21 },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.three, paddingBottom: Spacing.six },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 74, height: 74, borderRadius: 37 },
  avatarEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontFamily: Fonts.sansSemiBold },
  handle: { fontSize: 13.5, fontFamily: Fonts.sans },
  badges: { flexDirection: 'row', gap: Spacing.two, marginTop: 3 },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  roleBadgeText: { fontSize: 10.5, fontFamily: Fonts.sansMedium },

  counts: { flexDirection: 'row', alignItems: 'center' },
  countCell: { flex: 1, alignItems: 'center', gap: 1, paddingVertical: Spacing.one, minHeight: 48 },
  countValue: { fontSize: 17, fontFamily: Fonts.sansSemiBold },
  countLabel: { fontSize: 12, fontFamily: Fonts.sansMedium },
  countDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },

  actions: { flexDirection: 'row', gap: Spacing.two },
  followBtn: {
    flex: 1,
    borderRadius: 999,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnText: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
  msgBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { fontSize: 13, fontFamily: Fonts.sans, textAlign: 'center' },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three + Spacing.one, gap: Spacing.two },
  cardTitle: { fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  peopleLoading: { paddingVertical: Spacing.three },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one, minHeight: 52 },
  personAvatar: { width: 36, height: 36, borderRadius: 18 },
  personText: { flex: 1, gap: 1 },
  personName: { fontSize: 14, fontFamily: Fonts.sansMedium },
  personHandle: { fontSize: 12, fontFamily: Fonts.sans },

  interests: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  interestChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  interestText: { fontSize: 12, fontFamily: Fonts.sansMedium },
  joined: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 2 },

  showsSection: { gap: Spacing.two },
  sectionTitle: { fontFamily: Fonts.mono, fontSize: 10.5, letterSpacing: 1.8, marginLeft: 2 },
  showsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
