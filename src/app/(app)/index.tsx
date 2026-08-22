// Live — the app's home, and where guests land after the splash.
//
// Redesigned per docs/design-language.md (§5 hero, §6.1–6.2): PageAtmosphere
// ground → HeroOrbit (globe + orbiting cutouts + display type) → glass search
// pill → "Live now" glass cards → "Upcoming" rail → category bento (the 8
// site .webp tiles, scrim + frosted strip recipe, stand-up entrance).
//
// Everything on screen is REAL data: shows come from Firestore (public read),
// start times from real scheduled timestamps. The join warm-up pipeline is
// preserved exactly — markShowTapped/startJoin on tap, LiveCardPreview cards
// that HOLD the connection, re-warm on focus.
//
// GUEST FLOW (spec §6.2): signed-out users see all of home; every interaction
// (show card, category tile, search, upcoming row, header shortcuts) routes
// to /sign-in through useAuthGate with an action-specific reason. Signed-in
// behavior is unchanged — the gate runs the action synchronously.
//
// HONEST OMISSIONS (no backend source — never faked): viewer counts, seller
// avatars/verification, unread badges, "trending" ordering.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/brand/eyebrow';
import { FadeUp } from '@/components/brand/fade-up';
import { GlassCard } from '@/components/brand/glass-card';
import { GradientCTA } from '@/components/brand/gradient-cta';
import { HeroOrbit } from '@/components/brand/hero-orbit';
import { LivePulseDot } from '@/components/brand/live-pulse-dot';
import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { LiveCardPreview } from '@/components/live-card-preview';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { useScreenFocused } from '@/hooks/use-screen-focused';
import { useShows } from '@/hooks/use-shows';
import { useAuthGate, useIsGuest } from '@/lib/auth-gate';
import { dur, ease, getReducedMotionSync, stagger } from '@/lib/motion';
import { getOnboardingState } from '@/lib/onboarding';
import { useSession } from '@/lib/session';
import { markShowTapped } from '@/lib/stream';
import { startJoin } from '@/lib/stream-join';
import type { ShowData } from '@/lib/api';

/**
 * The category bento — the site's 8 landing tiles (assets/categories/*.webp),
 * labelled as on the website. `cat` is the REAL catalog category the tile
 * lands on in Browse (Sneakers and Streetwear share one combined category).
 */
const BENTO_TILES = [
  { label: 'Sneakers', cat: 'Sneakers & Streetwear', src: require('../../../assets/categories/sneakers.webp') },
  { label: 'Streetwear', cat: 'Sneakers & Streetwear', src: require('../../../assets/categories/streetwear.webp') },
  { label: 'Collectibles', cat: 'Collectibles', src: require('../../../assets/categories/collectibles.webp') },
  { label: 'Vintage & Antiques', cat: 'Vintage & Antiques', src: require('../../../assets/categories/vintage.webp') },
  { label: 'Fashion', cat: 'Fashion', src: require('../../../assets/categories/fashion.webp') },
  { label: 'Bags & Accessories', cat: 'Bags & Accessories', src: require('../../../assets/categories/bags.webp') },
  { label: 'Toys & Hobbies', cat: 'Toys & Hobbies', src: require('../../../assets/categories/toys.webp') },
  { label: 'Sports', cat: 'Sports', src: require('../../../assets/categories/sports.webp') },
] as const;

/** Fixed text-block height under the 16:10 thumb keeps grid rows aligned. */
const LIVE_CARD_BODY_H = 53;

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

/**
 * Tile stand-up (design-language §4): perspective 1200 + rotateX 11° + y 48 +
 * scale .95 → rest, 950ms ease.settle, stagger 80ms capped at index 5. Plain
 * Animated transforms on the native driver; reduce-motion lands at rest.
 * Memo'd so parent re-renders never touch a run that already happened.
 */
const StandUp = memo(function StandUp({
  index,
  style,
  children,
}: {
  index: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  // Lazy state, not a ref — stable identity, clean under react-hooks/refs.
  const [progress] = useState(() => new Animated.Value(0));
  const [delayMs] = useState(() => Math.min(index, stagger.tilesCap) * stagger.tiles);
  // Android: rasterize the tile to a hardware texture while the perspective
  // transform runs, then release it — a resident texture after the entrance
  // would cost memory and soften the tile's text for no benefit.
  const [animating, setAnimating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const settle = () => {
      if (!cancelled) setAnimating(false);
    };
    const run = (reduced: boolean) => {
      if (cancelled) return;
      if (reduced) {
        progress.setValue(1);
        settle();
        return;
      }
      Animated.timing(progress, {
        toValue: 1,
        duration: dur.standUp,
        delay: delayMs,
        easing: ease.settle,
        useNativeDriver: true,
      }).start(settle);
    };
    // Cached flag (lib/motion) → the stand-up starts on the first frame; the
    // async query is only the cold-start fallback before the cache seeds.
    const cached = getReducedMotionSync();
    if (cached !== null) run(cached);
    else
      AccessibilityInfo.isReduceMotionEnabled()
        .then(run)
        // Query failed → land at rest, never hide content.
        .catch(() => {
          progress.setValue(1);
          settle();
        });
    return () => {
      cancelled = true;
    };
  }, [progress, delayMs]);

  return (
    <Animated.View
      renderToHardwareTextureAndroid={animating}
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { perspective: 1200 },
            {
              rotateX: progress.interpolate({ inputRange: [0, 1], outputRange: ['11deg', '0deg'] }),
            },
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
});

/** Section head: mono eyebrow over an Archivo title, optional inline action. */
function SectionHeader({
  eyebrow,
  live = false,
  title,
  action,
  onAction,
}: {
  eyebrow: string;
  live?: boolean;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionHeadText}>
        <Eyebrow live={live}>{eyebrow}</Eyebrow>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {!!action && !!onAction && (
        <PressScale
          onPress={onAction}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={action}
          style={styles.inlineAction}
        >
          <Text style={styles.inlineActionText}>{action}</Text>
          <Ionicons name="arrow-forward" size={14} color={Brand.blueSky} />
        </PressScale>
      )}
    </View>
  );
}

/**
 * Search pill — glass, mono placeholder. It's a link into the Search tab (the
 * real input lives there); pressing shows the authAccent focus border.
 */
const SearchPill = memo(function SearchPill({ onPress }: { onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <PressScale
      onPress={onPress}
      onPressIn={() => setFocused(true)}
      onPressOut={() => setFocused(false)}
      accessibilityRole="search"
      accessibilityLabel="Search live shows, products or sellers"
      style={[styles.searchPill, focused && { borderColor: Brand.authAccent }]}
    >
      <Ionicons name="search-outline" size={18} color={Brand.mistSoft} />
      <Text numberOfLines={1} style={styles.searchPlaceholder}>
        Search shows · products · sellers
      </Text>
    </PressScale>
  );
});

/** Live-show card — 16:10 thumb radius 18 inside a white/5% glass card. */
function LiveCard({ show, width, onPress }: { show: ShowData; width: number; onPress: () => void }) {
  const thumbH = Math.round(width * 0.625); // 16:10
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Live show: ${show.name}${show.seller ? ` by ${show.seller}` : ''}`}
      style={{ width }}
    >
      <GlassCard variant="card" radius={18}>
        <View style={{ width: '100%', height: thumbH }}>
          {show.thumbnail ? (
            <Image
              source={{ uri: show.thumbnail }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={120}
            />
          ) : (
            // No thumbnail on the doc — a quiet branded surface, never a stock photo.
            <View style={styles.liveThumbFallback}>
              <Ionicons name="videocam-outline" size={26} color="rgba(159,180,216,0.4)" />
            </View>
          )}
          <View style={styles.liveTag}>
            <LivePulseDot color="#FFFFFF" size={5} />
            <Text style={styles.liveTagText}>LIVE</Text>
          </View>
        </View>
        <View style={styles.liveCardBody}>
          <Text numberOfLines={1} style={styles.liveCardTitle}>
            {show.name}
          </Text>
          <Text numberOfLines={1} style={styles.liveCardMeta}>
            {show.seller ? `by @${show.seller}` : show.sellerName || 'Live show'}
          </Text>
        </View>
      </GlassCard>
    </PressScale>
  );
}

function LiveGridSkeleton({ cardWidth }: { cardWidth: number }) {
  const h = Math.round(cardWidth * 0.625) + LIVE_CARD_BODY_H;
  const block = { backgroundColor: 'rgba(120,150,210,0.10)' };
  return (
    <View style={styles.liveGrid} accessibilityLabel="Loading live shows">
      {[0, 1].map((i) => (
        <View key={i} style={[block, { width: cardWidth, height: h, borderRadius: 18 }]} />
      ))}
    </View>
  );
}

export default function LiveScreen() {
  const { width, height: winH } = useWindowDimensions();
  const isGuest = useIsGuest();
  const requireAuth = useAuthGate();
  const { user } = useSession();
  const sessionUid = user?.uid ?? null;
  const { live, upcoming, loading, refreshing, error, fetchedAt: now, refresh } = useShows();

  const scrollRef = useRef<ScrollView>(null);
  const [upcomingY, setUpcomingY] = useState(0);

  const heroHeight = Math.round(winH * 0.55);
  const gridCardWidth = Math.floor((width - Spacing.three * 2 - Spacing.two) / 2);
  const liveCardHeight = Math.round(gridCardWidth * 0.625) + LIVE_CARD_BODY_H;

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

  const liveShown = live.slice(0, 8);

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

  // The tap path for live cards. Guests route to sign-in ('watch'); members
  // start the join warm-up so the Cloud Function round trip overlaps the
  // screen transition instead of following it. Preview cards already HOLD
  // the connection (or, on cellular, the room starts one) — no startJoin.
  const openLiveShow = (id: string, alreadyWarm: boolean) => {
    requireAuth('watch', () => {
      markShowTapped(id); // start the clock a buyer would start
      if (!alreadyWarm) startJoin(id);
      router.push({ pathname: '/live/[id]', params: { id } });
    });
  };

  return (
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* ── Header: shortcuts only — brand identity lives on the splash. ── */}
        <View style={styles.header}>
          <View style={styles.headerActions}>
            {/* Real routes; no badges — there is no unread-count source wired here. */}
            <PressScale
              onPress={() => requireAuth('inbox', () => router.push('/inbox'))}
              accessibilityRole="button"
              accessibilityLabel="Messages"
              hitSlop={8}
              style={styles.headerBtn}
            >
              <Ionicons name="chatbubble-outline" size={18} color={Brand.slate400} />
            </PressScale>
            <PressScale
              onPress={() => requireAuth('notifications', () => router.push('/notifications'))}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              hitSlop={8}
              style={styles.headerBtn}
            >
              <Ionicons name="notifications-outline" size={18} color={Brand.slate400} />
            </PressScale>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Brand.blueSky} />
          }
        >
          {/* ── Hero (isolated: all motion is UI-thread/native driver) ── */}
          <HeroOrbit height={heroHeight} />

          {/* ── Search — opens the real Search tab; guests → sign-in ── */}
          <FadeUp index={1} style={styles.searchWrap}>
            <SearchPill onPress={() => requireAuth('search', () => router.push('/browse'))} />
          </FadeUp>

          {/* ── Live now ───────────────────────────────────────────── */}
          <FadeUp index={2} style={styles.section}>
            <SectionHeader
              eyebrow="Happening now"
              live
              title="Live now"
              action={live.length > 8 ? 'See all' : undefined}
              onAction={
                live.length > 8
                  ? () => requireAuth('search', () => router.push('/browse'))
                  : undefined
              }
            />

            {!!error && (
              <View style={styles.errorRow}>
                <Ionicons name="cloud-offline-outline" size={17} color={Brand.dangerSoft} />
                <Text style={styles.errorText}>{error}</Text>
                <PressScale onPress={refresh} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry">
                  <Text style={styles.retry}>Retry</Text>
                </PressScale>
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
                      height={liveCardHeight}
                      renderVideo={liveTabFocused}
                      onPress={() => openLiveShow(String(s.id), true)}
                    />
                  ) : (
                    <LiveCard
                      key={String(s.id)}
                      show={s}
                      width={gridCardWidth}
                      onPress={() => openLiveShow(String(s.id), false)}
                    />
                  )
                )}
              </View>
            ) : !error ? (
              <GlassCard variant="card" radius={16} style={styles.liveEmpty}>
                <View style={styles.liveEmptyRing}>
                  <Ionicons name="radio-outline" size={22} color={Brand.blueSky} />
                </View>
                <Text style={styles.liveEmptyTitle}>No one is live right now</Text>
                <Text style={styles.liveEmptyBody}>
                  Shows will appear here as soon as sellers start streaming.
                </Text>
                <View style={styles.liveEmptyActions}>
                  <PressScale
                    onPress={() => requireAuth('browse', () => router.push('/categories'))}
                    accessibilityRole="button"
                    accessibilityLabel="Browse categories"
                    style={styles.inlineAction}
                  >
                    <Text style={styles.inlineActionText}>Browse categories</Text>
                    <Ionicons name="arrow-forward" size={14} color={Brand.blueSky} />
                  </PressScale>
                  {soon.length > 0 && (
                    <PressScale
                      onPress={() => scrollRef.current?.scrollTo({ y: upcomingY, animated: true })}
                      accessibilityRole="button"
                      accessibilityLabel="View upcoming shows"
                      style={styles.inlineAction}
                    >
                      <Text style={styles.inlineActionText}>View upcoming shows</Text>
                      <Ionicons name="arrow-forward" size={14} color={Brand.blueSky} />
                    </PressScale>
                  )}
                </View>
              </GlassCard>
            ) : null}
          </FadeUp>

          {/* ── Upcoming shows — omitted entirely when none exist ──── */}
          {soon.length > 0 && (
            <View onLayout={(e) => setUpcomingY(e.nativeEvent.layout.y)}>
              <FadeUp index={3} style={styles.section}>
                <SectionHeader eyebrow="Starting soon" title="Upcoming shows" />
                <GlassCard variant="card" radius={16} style={styles.upList}>
                  {soon.map((s, i) => {
                    const rel = startsIn(s.scheduled_time as string, now);
                    return (
                      <PressScale
                        key={String(s.id)}
                        onPress={() =>
                          // 'watch', not 'remind' — the row opens the show
                          // page, it doesn't set a reminder.
                          requireAuth('watch', () =>
                            router.push({ pathname: '/show/[id]', params: { id: String(s.id) } })
                          )
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`${s.name} by ${s.seller}, ${whenLabel(s.scheduled_time as string)}`}
                        style={[styles.upRow, i > 0 && styles.upRowDivider]}
                      >
                        {s.thumbnail ? (
                          <Image source={{ uri: s.thumbnail }} style={styles.upThumb} contentFit="cover" />
                        ) : (
                          <View style={[styles.upThumb, styles.upThumbFallback]}>
                            <Ionicons name="videocam-outline" size={17} color="rgba(159,180,216,0.5)" />
                          </View>
                        )}
                        <View style={styles.upBody}>
                          <Text numberOfLines={1} style={styles.upTitle}>
                            {s.name}
                          </Text>
                          <Text numberOfLines={1} style={styles.upMeta}>
                            by @{s.seller}
                          </Text>
                        </View>
                        <View style={styles.upRight}>
                          <Text style={styles.upWhen}>{whenLabel(s.scheduled_time as string)}</Text>
                          {!!rel && <Text style={styles.upRel}>{rel}</Text>}
                        </View>
                      </PressScale>
                    );
                  })}
                </GlassCard>
              </FadeUp>
            </View>
          )}

          {/* ── Category bento — the site tile recipe, stand-up entrance ── */}
          <View style={styles.section}>
            <FadeUp index={4}>
              <SectionHeader
                eyebrow="Any & all of it"
                title="Shop by category"
                action="See all"
                onAction={() => requireAuth('browse', () => router.push('/categories'))}
              />
            </FadeUp>
            <View style={styles.bentoGrid}>
              {BENTO_TILES.map((tile, i) => (
                <StandUp key={tile.label} index={i} style={{ width: gridCardWidth }}>
                  <PressScale
                    onPress={() =>
                      requireAuth('browse', () =>
                        router.push({ pathname: '/browse', params: { cat: tile.cat } })
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Browse ${tile.label}`}
                  >
                    <View style={[styles.bentoCard, { height: Math.round(gridCardWidth * 1.06) }]}>
                      <Image source={tile.src} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                      {/* Bottom scrim: black/70 → transparent. */}
                      <LinearGradient
                        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']}
                        style={styles.bentoScrim}
                      />
                      {/* Frosted bottom strip: white/5% + top hairline. */}
                      <View style={styles.bentoStrip}>
                        <Text numberOfLines={1} style={styles.bentoLabel}>
                          {tile.label}
                        </Text>
                      </View>
                    </View>
                  </PressScale>
                </StandUp>
              ))}
            </View>
          </View>

          {/* ── Guest close — the only in-flow sign-in ask on home ──── */}
          {isGuest && (
            <FadeUp index={5} style={styles.guestBlock}>
              <Text style={styles.guestNote}>
                You’re browsing as a guest. Sign in to watch shows, bid, buy or chat.
              </Text>
              <GradientCTA
                title="Sign in"
                arrow
                onPress={() => router.push('/sign-in')}
                accessibilityLabel="Sign in to Any and All"
                style={styles.guestCta}
              />
            </FadeUp>
          )}

          {/* Footer breathing room. */}
          <View style={{ height: Spacing.five }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  headerActions: { marginLeft: 'auto', flexDirection: 'row', gap: Spacing.two },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { paddingBottom: Spacing.five, gap: Spacing.four },
  section: { gap: Spacing.two + Spacing.one },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  sectionHeadText: { flex: 1, gap: 7 },
  sectionTitle: {
    color: Brand.text,
    fontSize: 24,
    fontFamily: Fonts.displayMedium,
    letterSpacing: -0.5,
  },
  inlineAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 3 },
  inlineActionText: { fontSize: 13, fontFamily: Fonts.uiSemiBold, color: Brand.blueSky },

  searchWrap: { paddingHorizontal: Spacing.three },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 999,
    paddingHorizontal: Spacing.three + 2,
    minHeight: 46,
  },
  searchPlaceholder: {
    flex: 1,
    color: Brand.mistSoft,
    fontFamily: Fonts.mono,
    fontSize: 12.5,
    letterSpacing: 0.3,
  },

  liveGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  liveThumbFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.ink800,
  },
  liveTag: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Brand.liveRose,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveTagText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: Fonts.uiExtraBold,
    letterSpacing: 1,
  },
  liveCardBody: {
    height: LIVE_CARD_BODY_H,
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 12,
  },
  liveCardTitle: { color: Brand.text, fontSize: 13.5, fontFamily: Fonts.uiSemiBold },
  liveCardMeta: { color: Brand.slate400, fontSize: 11.5, fontFamily: Fonts.ui },

  liveEmpty: {
    marginHorizontal: Spacing.three,
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
    borderColor: 'rgba(120,150,210,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  liveEmptyTitle: { color: Brand.text, fontSize: 15.5, fontFamily: Fonts.uiSemiBold },
  liveEmptyBody: {
    color: Brand.slate400,
    fontSize: 13,
    fontFamily: Fonts.ui,
    lineHeight: 18,
    textAlign: 'center',
  },
  liveEmptyActions: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: Spacing.one,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },

  upList: { marginHorizontal: Spacing.three },
  upRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two + 2,
    minHeight: 58,
  },
  upRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.hairlineWhite,
  },
  upThumb: { width: 42, height: 42, borderRadius: 10 },
  upThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.ink800,
  },
  upBody: { flex: 1, gap: 1 },
  upTitle: { color: Brand.text, fontSize: 14, fontFamily: Fonts.uiSemiBold },
  upMeta: { color: Brand.slate400, fontSize: 12, fontFamily: Fonts.ui },
  upRight: { alignItems: 'flex-end', gap: 2 },
  upWhen: { color: Brand.slate400, fontSize: 11.5, fontFamily: Fonts.ui },
  upRel: { color: Brand.blueSky, fontSize: 11.5, fontFamily: Fonts.uiSemiBold },

  bentoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  bentoCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    backgroundColor: Brand.ink800,
    overflow: 'hidden',
  },
  bentoScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
  },
  bentoStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderTopWidth: 1,
    borderTopColor: Brand.hairlineWhite,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bentoLabel: { color: Brand.text, fontSize: 13.5, fontFamily: Fonts.uiBold },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    borderWidth: 1,
    borderColor: 'rgba(230,57,70,0.4)',
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  errorText: { flex: 1, color: Brand.text, fontSize: 13, fontFamily: Fonts.ui },
  retry: { color: Brand.blueSky, fontSize: 13, fontFamily: Fonts.uiSemiBold },

  guestBlock: {
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  guestNote: {
    // mistSoft, not mistFaint — this is a sentence the guest must READ, and
    // 40% white fails contrast at 12px; faint stays reserved for decoration.
    color: Brand.mistSoft,
    fontSize: 12,
    fontFamily: Fonts.ui,
    textAlign: 'center',
  },
  guestCta: { alignSelf: 'stretch', marginHorizontal: Spacing.three },
});
