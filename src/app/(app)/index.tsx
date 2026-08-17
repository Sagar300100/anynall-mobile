// Live — the app's home, and where guests land after the splash.
//
// Layout follows the approved homepage reference (header → search → category
// rail → Live now grid → Browse more categories → Upcoming shows), with every
// piece of content real: shows come from Firestore (public read), categories
// come from the project's approved category source (lib/categories, ported
// from the web app's onboarding constants), and start times are computed from
// real scheduled timestamps.
//
// HONEST OMISSIONS (no backend source — never faked):
// - viewer counts (no field on show docs)
// - seller avatars / verification badges on cards (no reliable fields)
// - seller-verification banner (mobile has no seller/KYC state source)
// - unread badges on the inbox/notification shortcuts (no count source wired)
// - "Trending" ordering (no analytics; Browse-more simply lists categories
//   with current shows first, and is not labelled as popularity)
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiveCardPreview } from '@/components/live-card-preview';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useScreenFocused } from '@/hooks/use-screen-focused';
import { useShows } from '@/hooks/use-shows';
import { useIsGuest } from '@/lib/auth-gate';
import { categoryArtwork, categoryIcon, hasArtwork } from '@/lib/category-art';
import { CATEGORIES } from '@/lib/categories';
import { getOnboardingState } from '@/lib/onboarding';
import { useSession } from '@/lib/session';
import { markShowTapped } from '@/lib/stream';
import { startJoin } from '@/lib/stream-join';
import type { ShowData } from '@/lib/api';

/** Matches the navy field baked into the approved category artwork crops. */
const ART_BG = '#010F27';

/** "Starts in 15m" / "Starts in 2h" / "In 3d" from a REAL timestamp. */
function startsIn(iso: string, now: number): string | null {
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return null;
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `Starts in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Starts in ${hours}h`;
  return `In ${Math.round(hours / 24)}d`;
}

/** "Today, 10:00 am" / "Tomorrow, 6:30 pm" / "12 Aug, 1:00 pm" — real time. */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return `Today, ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, tomorrow)) return `Tomorrow, ${time}`;
  return `${d.getDate()} ${d.toLocaleString([], { month: 'short' })}, ${time}`;
}

function SectionHeader({ title, support, action, onAction }: {
  title: string;
  support?: string;
  action?: string;
  onAction?: () => void;
}) {
  const c = useBrandColors();
  return (
    <View style={styles.sectionHead}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>{title}</Text>
        {!!support && <Text style={[styles.sectionSupport, { color: c.textSecondary }]}>{support}</Text>}
      </View>
      {!!action && !!onAction && (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" accessibilityLabel={action}>
          <View style={styles.inlineAction}>
            <Text style={[styles.inlineActionText, { color: c.primary }]}>{action}</Text>
            <Ionicons name="arrow-forward" size={14} color={c.primary} />
          </View>
        </Pressable>
      )}
    </View>
  );
}

/** Live-show card for the 2-column grid — real fields only. */
function LiveCard({ show, width }: { show: ShowData; width: number }) {
  const c = useBrandColors();
  const height = Math.round(width * 1.25);
  return (
    <Pressable
      onPress={() => {
        // Start minting the viewer token now so the Cloud Function round trip
        // overlaps the screen transition instead of following it.
        markShowTapped(String(show.id)); // start the clock a buyer would start
        // The WHOLE join — token AND connect — begins here, overlapping the
        // screen transition. The room screen adopts it mid-flight.
        startJoin(String(show.id));
        router.push({ pathname: '/live/[id]', params: { id: String(show.id) } });
      }}
      accessibilityRole="button"
      accessibilityLabel={`Live show: ${show.name}${show.seller ? ` by ${show.seller}` : ''}`}
      style={({ pressed }) => [
        styles.liveCard,
        { width, height, backgroundColor: c.backgroundElement, borderColor: c.border },
        pressed && { opacity: 0.8 },
      ]}
    >
      {show.thumbnail ? (
        <Image source={{ uri: show.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
      ) : (
        // No thumbnail on the doc — a quiet branded surface, never a stock photo.
        <View style={styles.liveCardFallback}>
          <Ionicons name="videocam-outline" size={28} color="rgba(159,180,216,0.4)" />
        </View>
      )}
      <View style={styles.liveBadge}>
        <View style={styles.liveDot} />
        <Text style={styles.liveBadgeText}>LIVE</Text>
      </View>
      <View style={styles.liveCardScrim}>
        <Text numberOfLines={1} style={styles.liveCardTitle}>{show.name}</Text>
        <Text numberOfLines={1} style={styles.liveCardMeta}>
          {show.seller ? `by @${show.seller}` : show.sellerName || 'Live show'}
        </Text>
      </View>
    </Pressable>
  );
}

function LiveGridSkeleton({ cardWidth }: { cardWidth: number }) {
  const block = { backgroundColor: 'rgba(120,150,210,0.10)' };
  return (
    <View style={styles.liveGrid} accessibilityLabel="Loading live shows">
      {[0, 1].map((i) => (
        <View key={i} style={[block, { width: cardWidth, height: cardWidth * 1.25, borderRadius: 14 }]} />
      ))}
    </View>
  );
}

export default function LiveScreen() {
  const c = useBrandColors();
  const { width } = useWindowDimensions();
  const isGuest = useIsGuest();
  const { user } = useSession();
  const sessionUid = user?.uid ?? null;
  const { shows, live, upcoming, loading, refreshing, error, fetchedAt: now, refresh } = useShows();

  const scrollRef = useRef<ScrollView>(null);
  const [upcomingY, setUpcomingY] = useState(0);

  const gridCardWidth = Math.floor((width - Spacing.three * 2 - Spacing.two) / 2);

  // Genuinely-in-the-future scheduled shows only — a stale past timestamp
  // must never render as "starts in".
  const soon = useMemo(() => {
    if (!now) return [];
    return upcoming
      .filter((s) => !!s.scheduled_time && new Date(s.scheduled_time as string).getTime() > now)
      .sort(
        (a, b) =>
          new Date(a.scheduled_time as string).getTime() - new Date(b.scheduled_time as string).getTime()
      )
      .slice(0, 6);
  }, [upcoming, now]);

  // Browse-more subset: categories that currently have real shows first, then
  // the approved order. This is activity-informed ordering, not "trending".
  const browseMore = useMemo(() => {
    const active = new Set(shows.map((s) => s.category));
    return [...CATEGORIES]
      .sort((a, b) => (active.has(b) ? 1 : 0) - (active.has(a) ? 1 : 0))
      .slice(0, 6);
  }, [shows]);

  // The compact rail is curated to artwork-backed categories; the full list
  // (including icon-fallback ones) lives on the All Categories screen.
  const railCategories = CATEGORIES.filter(hasArtwork).slice(0, 8);
  const liveShown = live.slice(0, 8);

  // Warm the first live show while the buyer is still reading the list, so
  // tapping it renders an already-connected stream instead of starting a
  // ~3s token + handshake + keyframe sequence. One show only, Wi-Fi only, and
  // it drops itself if unused — see lib/stream-preconnect.
  //
  // Re-warms on every FOCUS, not just on mount. Opening a show CLAIMS the warm
  // room (ownership moves to the viewer screen), so coming back to this tab
  // left nothing warm — and because `firstLiveId` hadn't changed, a mount-only
  // effect never re-ran. First open was fast, every one after it was slow.
  // First-run setup. Asked ONCE per install per account: the server records a
  // skip, so declining is remembered. Guests are never prompted — the app is
  // deliberately browsable signed-out.
  const askedOnboarding = useRef(false);
  useEffect(() => {
    if (isGuest || askedOnboarding.current) return;
    let cancelled = false;
    (async () => {
      const state = await getOnboardingState();
      if (cancelled || !state) return;
      // The delivery address is mandatory, so a buyer without one is always
      // prompted — interests alone no longer satisfy onboarding.
      if (!state.hasAddress) {
        askedOnboarding.current = true;
        router.push('/welcome');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGuest]);

  // The first live card PLAYS its show (LiveCardPreview) instead of being
  // speculatively warmed — the card holds the connection, so opening the show
  // is a mode flip on live video, not a join. Never for the buyer's OWN show:
  // a seller watching their own card would hold a viewer connection that
  // fights their broadcast.
  // BOTH visible grid cards preview, not just the first — a buyer taps
  // whichever show looks good, and "the special fast card" is a trap nobody
  // can see. Never the buyer's own show (a seller watching their own card
  // would fight their broadcast).
  // Cards render their VIDEO only while this tab is on screen. Two
  // VideoTrack views cannot attach to one track, so a card left rendering
  // behind the open room starved the room's own view — black screen with a
  // spinner despite the connection being shared and ready in 5ms. The
  // CONNECTION stays up either way; only the view is released.
  const liveTabFocused = useScreenFocused(true);
  const previewIds = new Set(
    liveShown
      .filter((s) => s.ownerUid !== sessionUid)
      .slice(0, 2)
      .map((s) => String(s.id))
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      {/* ── Header: shortcuts only — brand identity lives on the splash. ── */}
      <View style={styles.header}>
        <View style={styles.headerActions}>
          {/* Real routes; no badges — there is no unread-count source wired here. */}
          <Pressable
            onPress={() => router.push('/inbox')}
            accessibilityRole="button"
            accessibilityLabel="Messages"
            hitSlop={8}
            style={styles.headerBtn}
          >
            <Ionicons name="chatbubble-outline" size={20} color={c.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            hitSlop={8}
            style={styles.headerBtn}
          >
            <Ionicons name="notifications-outline" size={20} color={c.textSecondary} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />
        }
      >
        {/* ── Search — opens the real Search tab ─────────────────── */}
        <Pressable
          onPress={() => router.push('/browse')}
          accessibilityRole="search"
          accessibilityLabel="Search live shows, products or sellers"
          style={({ pressed }) => [
            styles.searchBar,
            { backgroundColor: c.cardBackground, borderColor: c.borderStrong },
            pressed && { opacity: 0.75 },
          ]}
        >
          <Ionicons name="search-outline" size={19} color={c.textSecondary} />
          <Text style={[styles.searchPlaceholder, { color: c.textSecondary }]}>
            Search live shows, products or sellers
          </Text>
        </Pressable>

        {/* ── Category rail (approved source) + All Categories ───── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catRail}
        >
          {railCategories.map((cat) => (
            <Pressable
              key={cat}
              onPress={() => router.push({ pathname: '/browse', params: { cat } })}
              accessibilityRole="button"
              accessibilityLabel={`Browse ${cat}`}
              style={({ pressed }) => [styles.catTile, pressed && { opacity: 0.75 }]}
            >
              <View style={[styles.catImageWrap, { borderColor: c.border, backgroundColor: ART_BG }]}>
                <Image
                  source={categoryArtwork(cat) ?? undefined}
                  style={styles.catImage}
                  contentFit="contain"
                  transition={120}
                />
              </View>
              <Text numberOfLines={2} style={[styles.catLabel, { color: c.textSecondary }]}>
                {cat}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => router.push('/categories')}
            accessibilityRole="button"
            accessibilityLabel="All categories"
            style={({ pressed }) => [styles.catTile, pressed && { opacity: 0.75 }]}
          >
            <View
              style={[
                styles.catImageWrap,
                styles.allCatTile,
                { borderColor: c.primary, backgroundColor: 'rgba(74,143,229,0.12)' },
              ]}
            >
              <Ionicons name="grid-outline" size={22} color={c.primary} />
            </View>
            <Text numberOfLines={2} style={[styles.catLabel, { color: c.primary }]}>
              All Categories
            </Text>
          </Pressable>
        </ScrollView>

        {/* ── Live now ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader
            title="Live now"
            support="Join live shows, bid and buy in real time"
            action={live.length > 8 ? 'See all' : undefined}
            onAction={live.length > 8 ? () => router.push('/browse') : undefined}
          />

          {!!error && (
            <View style={[styles.errorRow, { borderColor: 'rgba(230,57,70,0.4)' }]}>
              <Ionicons name="cloud-offline-outline" size={17} color={c.danger} />
              <Text style={[styles.errorText, { color: c.text }]}>{error}</Text>
              <Pressable onPress={refresh} hitSlop={8}>
                <Text style={[styles.retry, { color: c.primary }]}>Retry</Text>
              </Pressable>
            </View>
          )}

          {loading ? (
            <LiveGridSkeleton cardWidth={gridCardWidth} />
          ) : liveShown.length > 0 ? (
            <View style={styles.liveGrid}>
              {liveShown.map((s) =>
                previewIds.has(String(s.id)) ? (
                  <LiveCardPreview
                    key={String(s.id)}
                    show={s}
                    width={gridCardWidth}
                    height={Math.round(gridCardWidth * 1.25)}
                    renderVideo={liveTabFocused}
                    onPress={() => {
                      markShowTapped(String(s.id));
                      // No startJoin: the card already holds the connection
                      // (or, on cellular, the room screen starts one).
                      router.push({ pathname: '/live/[id]', params: { id: String(s.id) } });
                    }}
                  />
                ) : (
                  <LiveCard key={String(s.id)} show={s} width={gridCardWidth} />
                )
              )}
            </View>
          ) : !error ? (
            <View style={[styles.liveEmpty, { borderColor: c.border, backgroundColor: c.cardBackground }]}>
              <View style={[styles.liveEmptyRing, { borderColor: 'rgba(120,150,210,0.24)' }]}>
                <Ionicons name="radio-outline" size={22} color={c.primary} />
              </View>
              <Text style={[styles.liveEmptyTitle, { color: c.text }]}>No one is live right now</Text>
              <Text style={[styles.liveEmptyBody, { color: c.textSecondary }]}>
                Shows will appear here as soon as sellers start streaming.
              </Text>
              <View style={styles.liveEmptyActions}>
                <Pressable
                  onPress={() => router.push('/categories')}
                  accessibilityRole="button"
                  accessibilityLabel="Browse categories"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <View style={styles.inlineAction}>
                    <Text style={[styles.inlineActionText, { color: c.primary }]}>Browse categories</Text>
                    <Ionicons name="arrow-forward" size={14} color={c.primary} />
                  </View>
                </Pressable>
                {soon.length > 0 && (
                  <Pressable
                    onPress={() => scrollRef.current?.scrollTo({ y: upcomingY, animated: true })}
                    accessibilityRole="button"
                    accessibilityLabel="View upcoming shows"
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <View style={styles.inlineAction}>
                      <Text style={[styles.inlineActionText, { color: c.primary }]}>View upcoming shows</Text>
                      <Ionicons name="arrow-forward" size={14} color={c.primary} />
                    </View>
                  </Pressable>
                )}
              </View>
            </View>
          ) : null}
        </View>

        {/* ── Browse more categories ─────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader
            title="Browse more categories"
            action="See all"
            onAction={() => router.push('/categories')}
          />
          <View style={styles.browseGrid}>
            {browseMore.map((cat) => {
              const art = categoryArtwork(cat);
              return (
                <Pressable
                  key={cat}
                  onPress={() => router.push({ pathname: '/browse', params: { cat } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Browse ${cat}`}
                  style={({ pressed }) => [
                    styles.browseCard,
                    { width: gridCardWidth, backgroundColor: c.cardBackground, borderColor: c.border },
                    pressed && { backgroundColor: 'rgba(120,150,210,0.09)' },
                  ]}
                >
                  {art ? (
                    <View style={[styles.browseImage, { backgroundColor: ART_BG }]}>
                      <Image source={art} style={styles.browseArt} contentFit="contain" transition={120} />
                    </View>
                  ) : (
                    // Controlled fallback: dark tile + one line icon, never a stock photo.
                    <View style={[styles.browseImage, styles.browseFallback, { backgroundColor: ART_BG }]}>
                      <Ionicons name={categoryIcon(cat)} size={22} color={c.primary} />
                    </View>
                  )}
                  <View style={styles.browseBody}>
                    <Text numberOfLines={2} style={[styles.browseName, { color: c.text }]}>{cat}</Text>
                    <View style={styles.inlineAction}>
                      <Text style={[styles.browseAction, { color: c.primary }]}>Browse</Text>
                      <Ionicons name="chevron-forward" size={13} color={c.primary} />
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── Upcoming shows — omitted entirely when none exist ──── */}
        {soon.length > 0 && (
          <View style={styles.section} onLayout={(e) => setUpcomingY(e.nativeEvent.layout.y)}>
            <SectionHeader title="Upcoming shows" support="Shows starting soon" />
            <View style={[styles.upList, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              {soon.map((s, i) => {
                const rel = startsIn(s.scheduled_time as string, now);
                return (
                  <Pressable
                    key={String(s.id)}
                    onPress={() => router.push({ pathname: '/show/[id]', params: { id: String(s.id) } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.name} by ${s.seller}, ${whenLabel(s.scheduled_time as string)}`}
                    style={({ pressed }) => [
                      styles.upRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                      pressed && { backgroundColor: 'rgba(120,150,210,0.07)' },
                    ]}
                  >
                    {s.thumbnail ? (
                      <Image source={{ uri: s.thumbnail }} style={styles.upThumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.upThumb, styles.upThumbFallback, { backgroundColor: c.backgroundElement }]}>
                        <Ionicons name="videocam-outline" size={17} color="rgba(159,180,216,0.5)" />
                      </View>
                    )}
                    <View style={styles.upBody}>
                      <Text numberOfLines={1} style={[styles.upTitle, { color: c.text }]}>{s.name}</Text>
                      <Text numberOfLines={1} style={[styles.upMeta, { color: c.textSecondary }]}>
                        by @{s.seller}
                      </Text>
                    </View>
                    <View style={styles.upRight}>
                      <Text style={[styles.upWhen, { color: c.textSecondary }]}>
                        {whenLabel(s.scheduled_time as string)}
                      </Text>
                      {!!rel && <Text style={[styles.upRel, { color: c.primary }]}>{rel}</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {isGuest && (
          <Text style={[styles.guestNote, { color: c.textFaint }]}>
            You’re browsing as a guest. Sign in to bid, buy or chat.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerActions: { marginLeft: 'auto', flexDirection: 'row', gap: Spacing.one },
  headerBtn: { padding: Spacing.one, minWidth: 34, alignItems: 'center' },

  scroll: { paddingBottom: Spacing.five, gap: Spacing.four },
  section: { gap: Spacing.two + Spacing.one },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  sectionTitle: { fontSize: 17, fontFamily: Fonts.sansSemiBold },
  sectionSupport: { fontSize: 12.5, fontFamily: Fonts.sans },
  inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  inlineActionText: { fontSize: 13, fontFamily: Fonts.sansMedium },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    minHeight: 46,
  },
  searchPlaceholder: { fontSize: 14, fontFamily: Fonts.sans },

  catRail: { paddingHorizontal: Spacing.three, gap: Spacing.two + Spacing.one },
  catTile: { width: 84, alignItems: 'center', gap: 6 },
  catImageWrap: {
    width: 84,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ~78% of the tile keeps the visible object near half the card height.
  catImage: { width: '78%', height: '78%' },
  allCatTile: { alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 11, fontFamily: Fonts.sansMedium, textAlign: 'center', lineHeight: 14 },

  liveGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  liveCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  liveCardFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  liveBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E63946',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFFFFF' },
  liveBadgeText: { color: '#FFFFFF', fontSize: 10, fontFamily: Fonts.sansSemiBold, letterSpacing: 0.5 },
  liveCardScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
    gap: 1,
    backgroundColor: 'rgba(3,7,18,0.72)',
  },
  liveCardTitle: { color: '#FFFFFF', fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  liveCardMeta: { color: 'rgba(200,214,238,0.85)', fontSize: 11.5, fontFamily: Fonts.sans },

  liveEmpty: {
    marginHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingVertical: Spacing.three + Spacing.one,
    paddingHorizontal: Spacing.four,
  },
  liveEmptyRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  liveEmptyTitle: { fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  liveEmptyBody: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18, textAlign: 'center' },
  liveEmptyActions: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: Spacing.one,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },

  browseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  browseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.two,
  },
  browseImage: {
    width: 52,
    height: 52,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  browseArt: { width: '84%', height: '84%' },
  browseFallback: { alignItems: 'center', justifyContent: 'center' },
  browseBody: { flex: 1, gap: 3 },
  browseName: { fontSize: 13, fontFamily: Fonts.sansSemiBold, lineHeight: 17 },
  browseAction: { fontSize: 12, fontFamily: Fonts.sansMedium },

  upList: { marginHorizontal: Spacing.three, borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  upRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two + 2,
    minHeight: 58,
  },
  upThumb: { width: 42, height: 42, borderRadius: 10 },
  upThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  upBody: { flex: 1, gap: 1 },
  upTitle: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
  upMeta: { fontSize: 12, fontFamily: Fonts.sans },
  upRight: { alignItems: 'flex-end', gap: 2 },
  upWhen: { fontSize: 11.5, fontFamily: Fonts.sans },
  upRel: { fontSize: 11.5, fontFamily: Fonts.sansMedium },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: Fonts.sans },
  retry: { fontSize: 13, fontFamily: Fonts.sansSemiBold },

  guestNote: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
});
