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
// Private accounts (Instagram-style, same as the web + firestore.rules):
// a private profile shows its identity and counts to everyone, but the
// content below (people lists, about, shows) only to approved followers or
// the owner. The Follow button cycles Follow → Requested (tap cancels the
// request) → Following (tap unfollows). Messaging is NOT gated by privacy —
// conversations open directly on both clients (the old mobile-only message
// request gate was removed; see lib/conversations.ts).
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/brand/eyebrow';
import { FadeUp } from '@/components/brand/fade-up';
import { GlassCard } from '@/components/brand/glass-card';
import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { ShowCard } from '@/components/show-card';
import { useBrandColors } from '@/components/ui/form';
import { Brand, CtaGradientShell, Fonts, Spacing } from '@/constants/theme';
import type { ShowData } from '@/lib/api';
import { useAuthGate } from '@/lib/auth-gate';
import { getOrCreateDirectConversation } from '@/lib/conversations';
import {
  cancelFollowRequest,
  followUser,
  getFollowCounts,
  getFollowStatus,
  listFollowersOf,
  listFollowingOf,
  unfollowUser,
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
    // Seller shows load after the header is already on screen — but never for
    // a private profile the viewer isn't an approved follower of.
    const canSee = p.uid === user?.uid || !p.isPrivate || st === 'following';
    if (p.isSeller && canSee) {
      try {
        const all = await fsFetchShows();
        setShows(all.filter((s) => s.ownerUid === uid));
      } catch {
        /* shows stay empty — the section simply doesn't render */
      }
    } else {
      setShows([]);
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
          await unfollowUser(profile.uid);
          setStatus('none');
          setCounts((v) => ({ ...v, followers: Math.max(0, v.followers - 1) }));
        } else if (status === 'requested') {
          // Tapping "Requested" withdraws the pending request.
          await cancelFollowRequest(profile.uid);
          setStatus('none');
        } else {
          // Private target → the lib files a follow request and returns
          // 'requested'; public target → follows immediately.
          const next = await followUser(profile.uid);
          setStatus(next);
          if (next === 'following')
            setCounts((v) => ({ ...v, followers: v.followers + 1 }));
        }
        // A private profile's content gate may have flipped — drop any open
        // people list rather than showing a stale one.
        setPeopleTab(null);
        setPeople(null);
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

  // Instagram gating: a private profile shows identity + counts to everyone,
  // but content (people lists, about, shows) only to approved followers.
  const canSeeContent = isOwner || !profile?.isPrivate || status === 'following';
  // follows reads are signed-in-only, so a guest's counts aggregation fails
  // and would silently render 0 — show "—" instead of a made-up number.
  const countsReadable = !!user;

  return (
    <View style={styles.rootWrap}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <PressScale
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={22} color={c.text} />
          </PressScale>
          <Text style={[styles.topTitle, { color: Brand.mist }]} numberOfLines={1}>
            {profile ? `@${profile.username || profile.displayName}` : 'Profile'}
          </Text>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Brand.blueSky} />
          </View>
        ) : notFound ? (
          <View style={styles.center}>
            <Ionicons name="person-circle-outline" size={40} color={Brand.mistFaint} />
            <Text style={[styles.body, { color: Brand.slate400 }]}>
              This profile doesn’t exist or isn’t available.
            </Text>
          </View>
        ) : profile ? (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* ── Header ── */}
            <FadeUp index={0} style={styles.header}>
              {profile.photoURL ? (
                <Image source={{ uri: profile.photoURL }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarEmpty, { borderColor: Brand.hairlineWhite }]}>
                  <Ionicons name="person-outline" size={30} color={Brand.slate400} />
                </View>
              )}
              <View style={styles.headerText}>
                <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                  {profile.displayName}
                </Text>
                {!!profile.username && (
                  <Text style={[styles.handle, { color: Brand.slate400 }]} numberOfLines={1}>
                    @{profile.username}
                  </Text>
                )}
                <View style={styles.badges}>
                  {profile.isSeller && (
                    <View style={[styles.roleBadge, { borderColor: 'rgba(74,143,229,0.4)' }]}>
                      <Ionicons name="storefront-outline" size={11} color={Brand.blueSky} />
                      <Text style={[styles.roleBadgeText, { color: Brand.blueSky }]}>Seller</Text>
                    </View>
                  )}
                  {profile.isPrivate && (
                    <View style={[styles.roleBadge, { borderColor: Brand.hairline }]}>
                      <Ionicons name="lock-closed-outline" size={11} color={Brand.slate400} />
                      <Text style={[styles.roleBadgeText, { color: Brand.slate400 }]}>Private</Text>
                    </View>
                  )}
                </View>
              </View>
            </FadeUp>

            {/* ── Counts ── */}
            <FadeUp index={1} style={styles.countsWrap}>
              <View style={styles.counts}>
                <CountCell
                  label="Followers"
                  value={countsReadable ? counts.followers : '—'}
                  onPress={() => openPeople('followers')}
                  active={peopleTab === 'followers'}
                  disabled={!countsReadable || !canSeeContent}
                />
                <View style={[styles.countDivider, { backgroundColor: Brand.hairlineWhite }]} />
                <CountCell
                  label="Following"
                  value={countsReadable ? counts.following : '—'}
                  onPress={() => openPeople('following')}
                  active={peopleTab === 'following'}
                  disabled={!countsReadable || !canSeeContent}
                />
              </View>

              {/* ── Actions ── */}
              {!isOwner && (
                <View style={styles.actions}>
                  <PressScale
                    onPress={handleFollowPress}
                    disabled={followBusy}
                    accessibilityRole="button"
                    accessibilityLabel={
                      status === 'following'
                        ? 'Unfollow'
                        : status === 'requested'
                          ? 'Cancel follow request'
                          : 'Follow'
                    }
                    accessibilityState={{ disabled: followBusy, selected: status !== 'none' }}
                    style={[
                      styles.followBtn,
                      status !== 'none' && styles.followBtnGhost,
                      followBusy && { opacity: 0.75 },
                    ]}
                  >
                    {status === 'none' ? (
                      <LinearGradient
                        colors={[...CtaGradientShell]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.followFill}
                      >
                        {followBusy ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.followBtnText}>Follow</Text>
                        )}
                      </LinearGradient>
                    ) : followBusy ? (
                      <ActivityIndicator size="small" color={c.text} />
                    ) : (
                      <Text style={styles.followBtnText}>
                        {status === 'following' ? 'Following' : 'Requested'}
                      </Text>
                    )}
                  </PressScale>
                  <PressScale
                    onPress={handleMessagePress}
                    disabled={messaging}
                    accessibilityRole="button"
                    accessibilityLabel={`Message ${profile.displayName}`}
                    style={[styles.msgBtn, messaging && { opacity: 0.7 }]}
                  >
                    {messaging ? (
                      <ActivityIndicator size="small" color={c.text} />
                    ) : (
                      <Ionicons name="chatbubble-outline" size={17} color={c.text} />
                    )}
                  </PressScale>
                </View>
              )}
            </FadeUp>

            {!!error && <Text style={[styles.errorText, { color: Brand.dangerSoft }]}>{error}</Text>}

            {!canSeeContent ? (
              /* ── Private gate — identity/counts above stay visible, the
                    content below requires an approved follow. ── */
              <FadeUp index={2}>
                <GlassCard style={[styles.card, styles.lockCard]}>
                  <Ionicons name="lock-closed-outline" size={26} color={Brand.slate400} />
                  <Text style={[styles.lockTitle, { color: c.text }]}>This account is private</Text>
                  <Text style={[styles.body, styles.lockBody, { color: Brand.slate400 }]}>
                    Follow {profile.displayName} to see their shows and activity.
                  </Text>
                </GlassCard>
              </FadeUp>
            ) : (
            <>
                {/* ── People list (lazy) ── */}
                {peopleTab && (
                  <GlassCard style={styles.card}>
                    <Text style={[styles.cardTitle, { color: c.text }]}>
                      {peopleTab === 'followers' ? 'Followers' : 'Following'}
                    </Text>
                    {people === null ? (
                      <ActivityIndicator color={Brand.blueSky} style={styles.peopleLoading} />
                    ) : people.length === 0 ? (
                      // mistSoft: this is a sentence to READ, not decoration.
                      <Text style={[styles.body, { color: Brand.mistSoft }]}>
                        {peopleTab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
                      </Text>
                    ) : (
                      people.map((p) => (
                        <PressScale
                          key={p.uid}
                          onPress={() =>
                            router.push({
                              pathname: '/user/[username]',
                              params: { username: p.username || p.uid, uid: p.uid },
                            })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`View ${p.name}'s profile`}
                          style={styles.personRow}
                        >
                          {p.photoURL ? (
                            <Image source={{ uri: p.photoURL }} style={styles.personAvatar} contentFit="cover" />
                          ) : (
                            <View style={[styles.personAvatar, styles.avatarEmpty, { borderColor: Brand.hairlineWhite }]}>
                              <Ionicons name="person-outline" size={14} color={Brand.slate400} />
                            </View>
                          )}
                          <View style={styles.personText}>
                            <Text style={[styles.personName, { color: c.text }]} numberOfLines={1}>
                              {p.name}
                            </Text>
                            {!!p.username && (
                              <Text style={[styles.personHandle, { color: Brand.mistFaint }]} numberOfLines={1}>
                                @{p.username}
                              </Text>
                            )}
                          </View>
                          <Ionicons name="chevron-forward" size={15} color={Brand.mistFaint} />
                        </PressScale>
                      ))
                    )}
                  </GlassCard>
                )}

                {/* ── About ── */}
                <FadeUp index={2}>
                  <GlassCard style={styles.card}>
                    <Text style={[styles.cardTitle, { color: c.text }]}>About</Text>
                    {/* Fallback copy is still READING text → mistSoft, not faint. */}
                    <Text style={[styles.body, { color: profile.bio ? Brand.mist : Brand.mistSoft }]}>
                      {profile.bio ||
                        (isOwner
                          ? 'This is your bio. Add a few lines about yourself on anynall.com so others can know you better.'
                          : 'No bio yet.')}
                    </Text>
                    {profile.interests.length > 0 && (
                      <View style={styles.interests}>
                        {profile.interests.map((tag) => (
                          <View key={tag} style={[styles.interestChip, { borderColor: Brand.hairlineWhite }]}>
                            <Text style={[styles.interestText, { color: Brand.slate400 }]}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {!!joinedLabel(profile.createdAtMs) && (
                      <Text style={[styles.joined, { color: Brand.mistFaint }]}>
                        {joinedLabel(profile.createdAtMs)}
                      </Text>
                    )}
                  </GlassCard>
                </FadeUp>

                {/* ── Seller shows ── */}
                {profile.isSeller && (liveShows.length > 0 || upcomingShows.length > 0) && (
                  <>
                    {liveShows.length > 0 && (
                      <View style={styles.showsSection}>
                        <Eyebrow live color={Brand.liveRose} style={styles.sectionTitle}>
                          Live now
                        </Eyebrow>
                        <View style={styles.showsGrid}>
                          {liveShows.map((s) => (
                            <ShowCard key={String(s.id)} show={s} width={GRID_CARD_WIDTH} />
                          ))}
                        </View>
                      </View>
                    )}
                    {upcomingShows.length > 0 && (
                      <View style={styles.showsSection}>
                        <Eyebrow style={styles.sectionTitle}>Shows</Eyebrow>
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
            )}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

function CountCell({
  label,
  value,
  onPress,
  active,
  disabled = false,
}: {
  label: string;
  /** "—" when the viewer can't read counts (guests — follows is signed-in-only). */
  value: number | string;
  onPress: () => void;
  active: boolean;
  /** Guests can't read the lists, and private profiles hide them. */
  disabled?: boolean;
}) {
  const c = useBrandColors();
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      accessibilityState={{ expanded: active, disabled }}
      style={styles.countCell}
    >
      <Text style={[styles.countValue, { color: c.text }]}>{value}</Text>
      <Text style={[styles.countLabel, { color: active ? Brand.blueSky : Brand.slate400 }]}>
        {label}
      </Text>
    </PressScale>
  );
}

// Two-up grid with the screen's horizontal padding and gap accounted for.
const GRID_CARD_WIDTH = (Dimensions.get('window').width - Spacing.three * 2 - Spacing.two) / 2;

const styles = StyleSheet.create({
  rootWrap: { flex: 1, backgroundColor: Brand.ink950 },
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
  topTitle: { flex: 1, fontSize: 14, fontFamily: Fonts.mono, letterSpacing: 0.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  body: { fontSize: 14, fontFamily: Fonts.ui, lineHeight: 21 },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.three, paddingBottom: Spacing.six },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 74, height: 74, borderRadius: 37 },
  avatarEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  name: { fontSize: 22, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  handle: { fontSize: 12.5, fontFamily: Fonts.mono, letterSpacing: 0.5 },
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
  roleBadgeText: { fontSize: 10.5, fontFamily: Fonts.uiSemiBold },

  countsWrap: { gap: Spacing.three },
  counts: { flexDirection: 'row', alignItems: 'center' },
  countCell: { flex: 1, alignItems: 'center', gap: 1, paddingVertical: Spacing.one, minHeight: 48 },
  countValue: { fontSize: 18, fontFamily: Fonts.uiExtraBold },
  countLabel: { fontSize: 12, fontFamily: Fonts.uiSemiBold },
  countDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },

  actions: { flexDirection: 'row', gap: Spacing.two },
  followBtn: {
    flex: 1,
    borderRadius: 13,
    minHeight: 44,
    alignItems: 'stretch',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  followBtnGhost: {
    borderWidth: 1,
    borderColor: Brand.hairline,
    alignItems: 'center',
  },
  followFill: {
    minHeight: 44,
    alignSelf: 'stretch',
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnText: { fontSize: 14, fontFamily: Fonts.uiBold, color: '#FFFFFF' },
  msgBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Brand.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { fontSize: 13, fontFamily: Fonts.ui, textAlign: 'center' },

  card: { padding: Spacing.three + Spacing.one, gap: Spacing.two },
  cardTitle: { fontSize: 15.5, fontFamily: Fonts.uiSemiBold },
  lockCard: { alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.one },
  lockTitle: { fontSize: 15.5, fontFamily: Fonts.uiSemiBold, marginTop: Spacing.one },
  lockBody: { textAlign: 'center' },
  peopleLoading: { paddingVertical: Spacing.three },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one, minHeight: 52 },
  personAvatar: { width: 36, height: 36, borderRadius: 18 },
  personText: { flex: 1, gap: 1 },
  personName: { fontSize: 14, fontFamily: Fonts.uiSemiBold },
  personHandle: { fontSize: 12, fontFamily: Fonts.ui },

  interests: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  interestChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  interestText: { fontSize: 12, fontFamily: Fonts.uiSemiBold },
  joined: { fontSize: 12, fontFamily: Fonts.ui, marginTop: 2 },

  showsSection: { gap: Spacing.two },
  sectionTitle: { marginLeft: 2 },
  showsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
