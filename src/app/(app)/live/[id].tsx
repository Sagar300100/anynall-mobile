// Buyer live room — an immersive, full-bleed live-video screen.
//
// LAYOUT (top → bottom), following the reference this was built against:
//   • the video fills the whole screen; every control floats ON it, never in
//     a card, and the tab bar is hidden for this route (see (app)/_layout).
//   • header      seller avatar, name, rating/ships-from row, Follow, the
//                 viewer pill and the dismiss chevron.
//   • float cards engagement cards pinned to the right edge under the header.
//   • mid row     chat column on the left, the vertical action rail on the
//                 right, both bottom-aligned so they end at the composer.
//   • composer    "Say something…" pill plus a separate reaction circle.
//   • panel       the live lot (or the pinned Buy Now item) and the bid bar —
//                 the last thing on screen, exactly as the reference.
//
// Colour is Any&All: cobalt #2E6BFF where the reference is yellow, midnight
// navy translucent surfaces, white text. Money is ₹ paise throughout.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuctionPanel } from '@/components/auction-panel';
import { BuyNowSheet } from '@/components/buy-now-sheet';
import { GetReadySheet } from '@/components/get-ready-sheet';
import { pickSpotlight, ProductSpotlight } from '@/components/product-spotlight';
import { RazorpayCheckout } from '@/components/razorpay-checkout';
import { useBrandColors } from '@/components/ui/form';
import { ViewerStage } from '@/components/viewer-stage';
import { WinnerPaymentSheet } from '@/components/winner-payment-sheet';
import { Fonts, Spacing } from '@/constants/theme';
import { useScreenFocused } from '@/hooks/use-screen-focused';
import { useAuthGate } from '@/lib/auth-gate';
import { sendMessage, subscribeMessages, type ChatDoc } from '@/lib/chat';
import { db } from '@/lib/firebase';
import { follow, isFollowing, unfollow } from '@/lib/follows';
import {
  canBuyFromShow,
  formatPaise,
  getCommerceProfile,
  isReadyToBid,
  type AuctionRecord,
  type BuyEligibility,
  type BuyNowOrder,
  type CommerceProfile,
} from '@/lib/commerce';
import { subscribe as engineSubscribe, type EngineAuction } from '@/lib/auction-socket';
import type { LiveEvent } from '@/lib/live-bus';
import { listenAuctions, listenProducts, type ProductDoc } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { useShows } from '@/hooks/use-shows';

/** The reference dims the video only at the very top and the very bottom, so
 *  the item the seller is holding stays bright in the middle. A flat wash over
 *  the whole frame (what this used to do) greyed out the product. */
const SCRIM_TOP = ['rgba(3,7,18,0.85)', 'rgba(3,7,18,0)'] as const;
const SCRIM_BOTTOM = ['rgba(3,7,18,0)', 'rgba(3,7,18,0.55)', 'rgba(3,7,18,0.92)'] as const;

type RailSheet = 'wallet' | 'shop' | 'more';

/** Short pill/button wording per server verdict code.
 *
 *  /api/commerce/can-buy refuses for several different reasons and only one of
 *  them is about the buyer's State. Collapsing them all into one State message
 *  sends people to edit an address that was never the problem. */
function shortBlockLabel(code?: string): string {
  switch (code) {
    case 'INTERSTATE_BLOCKED':
      return 'Can’t ship to your State';
    case 'DELIVERY_STATE_REQUIRED':
      return 'Add a delivery address';
    case 'SELLER_STATE_UNKNOWN':
      return 'Seller’s State isn’t on file';
    case 'SELLER_NOT_ACTIVE':
      return 'Seller isn’t active yet';
    case 'SELLER_UNKNOWN':
      return 'Seller unavailable';
    default:
      return 'Buying unavailable';
  }
}

export default function LiveRoomScreen() {
  const c = useBrandColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const { shows } = useShows();
  const show = shows.find((s) => String(s.id) === String(id));

  const [messages, setMessages] = useState<ChatDoc[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatDoc>>(null);

  // ── Live commerce state (Firestore) ────────────────────────────────
  const [auctions, setAuctions] = useState<AuctionRecord[]>([]);
  const [products, setProducts] = useState<ProductDoc[]>([]);
  const [profile, setProfile] = useState<CommerceProfile | null>(null);
  const [getReadyOpen, setGetReadyOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Winner sheet dismissal is per-auction so a new auction can re-open it.
  const [dismissedWinFor, setDismissedWinFor] = useState<string | null>(null);
  // Buy Now: which product's sheet is open, and the created order in checkout.
  const [buyingProductId, setBuyingProductId] = useState<string | null>(null);
  const [buyOrder, setBuyOrder] = useState<BuyNowOrder | null>(null);
  // Follow + the right rail's sheets.
  const [following, setFollowing] = useState<boolean | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [rail, setRail] = useState<RailSheet | null>(null);
  // More → Hide chat. Local only; the messages keep streaming underneath.
  const [chatHidden, setChatHidden] = useState(false);
  // Tab screens stay mounted; only the visible screen may hold a LiveKit room.
  const screenFocused = useScreenFocused(true);
  const requireAuth = useAuthGate();

  const sellerUid = show?.ownerUid ?? null;

  // ── The show doc itself, live ──
  //
  // The header data comes from useShows() (a one-shot list fetch), which meant
  // the room NEVER heard the show end: the seller closed the broadcast, the
  // host track vanished, and every viewer sat on a frozen joining spinner with
  // no ended message and no way to the replay. One doc listener carries the
  // whole lifecycle: ended (isLive false + endedAt) and gone-live (for early
  // arrivals parked on SHOW_NOT_LIVE).
  const [liveState, setLiveState] = useState<{
    isLive: boolean;
    endedAt: string | null;
    replayUrl: string | null;
  } | null>(null);
  // Bumped when the show transitions to live so ViewerStage remounts and
  // retries the token it was refused with SHOW_NOT_LIVE. Keyed remount is the
  // retry: the failed join dropped itself, so a fresh adopt starts clean.
  const [stageEpoch, setStageEpoch] = useState(0);
  const prevLive = useRef<boolean | null>(null);

  useEffect(() => {
    if (!id) return;
    return onSnapshot(
      doc(db, 'shows', String(id)),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as any;
        setLiveState({
          isLive: !!d.isLive,
          endedAt: d.endedAt ?? null,
          replayUrl: d.replay_url ?? null,
        });
      },
      (err) => console.warn('[live] show listener error:', err?.message)
    );
  }, [id]);

  useEffect(() => {
    if (!liveState) return;
    const was = prevLive.current;
    prevLive.current = liveState.isLive;
    // Known-not-live → live is the only transition that needs a fresh join.
    // (First snapshot arrives with `was === null` and must NOT remount — the
    // warm join from the tap is already connecting.)
    if (was === false && liveState.isLive) setStageEpoch((e) => e + 1);
  }, [liveState]);

  const showEnded = !!liveState && !liveState.isLive && !!liveState.endedAt;

  // Can this buyer actually buy from this seller? A composition or eligible
  // unregistered seller may only deliver inside their own State, so an
  // out-of-State buyer can watch but not buy. Checked on entry so the bid
  // button is disabled with a reason, instead of failing after they commit.
  const [blocked, setBlocked] = useState<BuyEligibility | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const verdict = await canBuyFromShow(String(id));
        if (!cancelled) setBlocked(verdict.allowed ? null : verdict);
      } catch {
        // Display-only: never wrongly block on a network hiccup. The purchase
        // paths re-check server-side regardless.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The full sentence for the notice, and the short pill label. These used to
  // be the same hard-coded "Can't ship to your State", which was wrong for
  // every code except INTERSTATE_BLOCKED — a seller whose State isn't on file,
  // or an account not yet approved, both read as the buyer being out of range.
  const blockedReason = blocked
    ? blocked.message || 'You can’t buy from this seller right now.'
    : null;
  const blockedLabel = blocked ? shortBlockLabel(blocked.code) : null;

  useEffect(() => {
    if (!sellerUid) return;
    let cancelled = false;
    (async () => {
      const state = await isFollowing(sellerUid);
      if (!cancelled) setFollowing(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [sellerUid]);

  async function toggleFollow() {
    if (!sellerUid || followBusy) return;
    const next = !following;
    setFollowBusy(true);
    setFollowing(next); // optimistic; rolled back below
    try {
      await (next ? follow(sellerUid) : unfollow(sellerUid));
    } catch {
      setFollowing(!next);
      setNotice('Couldn’t update follow — please try again.');
    } finally {
      setFollowBusy(false);
    }
  }

  async function shareShow() {
    try {
      await Share.share({
        message: `${show?.name ?? 'Live on Any&All'} — https://anynall.com/show/${String(id)}`,
        url: `https://anynall.com/show/${String(id)}`,
      });
    } catch {
      /* dismissed */
    }
  }

  /** The reaction sends a real chat message — there is no separate reactions
   *  channel, so this rides the one that exists rather than animating nothing.
   *  Throttled per device: every tap is a Firestore write fanned out to every
   *  viewer in the room, so the cheapest-feeling tap must not be spammable. */
  const lastReactionAt = useRef(0);
  async function sendReaction() {
    if (!user) {
      requireAuth('chat', () => {});
      return;
    }
    const now = Date.now();
    if (now - lastReactionAt.current < 1000) return;
    lastReactionAt.current = now;
    try {
      await sendMessage(String(id), {
        user: user.displayName || user.email?.split('@')[0] || 'buyer',
        text: '🔥',
      });
    } catch {
      /* transient; the chat listener is the source of truth */
    }
  }

  // Chat reads are signed-in only (firestore.rules) — for a guest the listener
  // died with permission-denied and, with no error callback, the room simply
  // showed an empty chat that read as broken. Guests now get a sign-in prompt
  // in the chat column instead, and no doomed listener is opened at all.
  useEffect(() => {
    if (!id || !user) return;
    const unsubscribe = subscribeMessages(String(id), setMessages, () =>
      // Signed-in and the listener still died (rules change, outage) — say so
      // once rather than leaving a silently dead column.
      setNotice('Chat is unavailable right now.')
    );
    return unsubscribe;
  }, [id, user]);

  useEffect(() => {
    if (!id) return;
    const offAuctions = listenAuctions(String(id), setAuctions);
    const offProducts = listenProducts(String(id), setProducts);
    return () => {
      offAuctions();
      offProducts();
    };
  }, [id]);

  // ── The auction engine, when it exists ──
  //
  // Inert unless EXPO_PUBLIC_AUCTION_ENGINE_URL is set and the socket is up,
  // so this is safe to ship before the engine is deployed: the Firestore
  // listener above remains the only source of truth in that case, exactly as
  // it is today. Merged by version, so engine and Firestore can never fight.
  useEffect(() => {
    if (!id) return;
    const mergeOne = (a: EngineAuction) =>
      setAuctions((prev) =>
        prev.map((held) =>
          held.id === a.id && a.version > (held.version || 0)
            ? {
                ...held,
                currentBid: a.currentBid,
                currentBidderUid: a.currentBidderUid ?? undefined,
                currentBidderName: a.currentBidderName ?? undefined,
                bidCount: a.bidCount,
                endsAt: a.endsAt ?? held.endsAt,
                version: a.version,
              }
            : held
        )
      );

    return engineSubscribe(String(id), {
      onState: (list) => list.forEach(mergeOne),
      onBid: mergeOne,
      // A rejection the socket path can't deliver as a promise failure —
      // "outbid", "too low" — still has to reach the bidder.
      onError: (err) => setNotice(err.message),
    });
  }, [id]);

  /** A bid pushed over the video connection, ahead of Firestore.
   *
   *  Merged by VERSION, never blindly: the auction doc's `version` increments
   *  once per accepted bid, so a packet that is not strictly newer than what
   *  we already hold is dropped. That makes this safe against reordering and
   *  against a Firestore snapshot landing first — whichever arrives first
   *  wins, the other is a no-op, and the two can never fight.
   *
   *  useCallback because ViewerStage subscribes on identity; this screen
   *  re-renders every second on the auction tick and an unstable handler would
   *  tear the subscription down and rebuild it each time. */
  const applyLiveEvent = useCallback((event: LiveEvent) => {
    if (event.t !== 'bid') return;
    setAuctions((prev) =>
      prev.map((a) =>
        a.id === event.auctionId && event.version > (a.version || 0)
          ? {
              ...a,
              currentBid: event.amount,
              currentBidderUid: event.bidderUid,
              currentBidderName: event.bidderName,
              bidCount: event.bidCount,
              endsAt: event.endsAt,
              version: event.version,
            }
          : a
      )
    );
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // The commerce profile is fetched lazily so it never sits in front of the
  // video join. But Wallet READS it, and with nothing having triggered the
  // fetch it confidently reported "No delivery address saved yet" to buyers
  // who had one — and handed the same empty profile to the Get Ready sheet, so
  // the address form opened blank too. Load it when the sheet actually opens.
  useEffect(() => {
    if (rail !== 'wallet' || profile) return;
    let cancelled = false;
    getCommerceProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        /* the sheet's rows fall back to their empty text */
      });
    return () => {
      cancelled = true;
    };
  }, [rail, profile]);

  // Warm the profile the moment a lot goes on the block.
  //
  // ensureReady() needs it, and without this the FIRST bid paid for an ~800ms
  // round trip BEFORE the optimistic price could paint — so the one tap that
  // most needs to feel instant was the only slow one. Deliberately gated on a
  // live auction, not on entering the room, so it never sits in front of the
  // video join.
  const hasLot = auctions.some((a) => a.status === 'open');
  useEffect(() => {
    if (!hasLot || profile) return;
    let cancelled = false;
    getCommerceProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        /* ensureReady() will fetch it on the bid instead */
      });
    return () => {
      cancelled = true;
    };
  }, [hasLot, profile]);

  // The OPEN lot drives the panel — never blindly the newest doc. The list is
  // ordered by updatedAt, and the backend deliberately lets the seller start
  // the next lot while the previous winner pays (and lets a webhook bump an
  // older doc), so auctions[0] flips identity mid-payment: bound to it, the
  // winner's payment drawer vanished with the timer still running, and the
  // open lot's panel disappeared whenever a settled doc jumped the queue.
  // Same selection as the web room: find the open doc for the panel, fall back
  // to the newest for the brief just-sold state.
  const openAuction = auctions.find((a) => a.status === 'open') || null;
  const auction = openAuction || auctions[0] || null;
  const auctionProduct = auction
    ? products.find((p) => p.id === auction.productId) || null
    : null;

  // The winner sheet scans ALL docs for THIS user's unpaid win — its identity
  // is the win itself, independent of whatever the panel is showing.
  const wonAuction =
    (user &&
      auctions.find(
        (a) =>
          a.status === 'awaiting_winner_payment' &&
          (a.winnerUid || a.currentBidderUid) === user.uid &&
          dismissedWinFor !== a.id
      )) ||
    null;

  const spotlight = pickSpotlight(products);
  const buyingProduct = buyingProductId
    ? products.find((p) => p.id === buyingProductId) || null
    : null;

  // Real giveaways only — the count is items the seller actually listed as a
  // giveaway for this show. There is no entries/participants collection, so
  // "98 Entries" has no honest equivalent and isn't invented.
  const giveaways = products.filter((p) => p.kind === 'giveaway');

  // The rail's Shop tile shows the item on the block, like the reference.
  const railThumb = auctionProduct?.thumbnail_url || products.find((p) => p.thumbnail_url)?.thumbnail_url || null;

  /** Open Buy Now for a product, loading the commerce profile (for the saved
   *  address) on first use. */
  async function openBuyNow(productId: string) {
    // Belt and braces: the button is disabled, but never open checkout for a
    // seller who cannot deliver to this buyer.
    if (blockedReason) {
      setNotice(blockedReason);
      return;
    }
    if (!profile) {
      getCommerceProfile().then(setProfile).catch(() => {});
    }
    setBuyingProductId(productId);
  }

  /** Bid gate: profile must satisfy the server's preconditions, otherwise we
   *  open the one-time setup sheet and skip this bid.
   *
   *  Deliberately NOT wrapped in useCallback: the manual dep list ([profile])
   *  didn't match what the React Compiler infers (setProfile), which made it
   *  bail out of optimizing this entire screen. The compiler memoizes it. */
  const ensureReady = async (): Promise<boolean> => {
    let p = profile;
    if (!p) {
      try {
        p = await getCommerceProfile();
        setProfile(p);
      } catch {
        setNotice('Could not check your bid setup — try again.');
        return false;
      }
    }
    if (isReadyToBid(p)) return true;
    if (p && p.unpaidWins >= p.maxUnpaidWins) {
      setNotice('Complete your pending payment to continue bidding.');
      return false;
    }
    setGetReadyOpen(true);
    return false;
  };

  async function handleSend() {
    if (!user) {
      // The gate navigates to sign-in with the chat reason and brings the
      // buyer straight back here — the draft survives in state.
      requireAuth('chat', () => {});
      return;
    }
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(String(id), {
        user: user.displayName || user.email?.split('@')[0] || 'buyer',
        text,
      });
    } catch {
      setDraft(text); // give the text back on failure
    } finally {
      setSending(false);
    }
  }

  const sellerHandle = show?.seller || show?.sellerName || 'Seller';
  const rating = typeof show?.sellerRating === 'number' ? show.sellerRating : null;
  // Second fact on the meta line: where it ships from if the show says, else
  // the category. Without a fallback the line held only the Follow pill, which
  // then floated on an otherwise empty row under the name.
  const shipsFrom = show?.shippedFrom && show.shippedFrom !== 'N/A' ? show.shippedFrom : null;
  const category = show?.category && show.category !== 'Uncategorized' ? show.category : null;
  const secondary = shipsFrom || category;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* Video stage — full bleed, behind everything.
          Mounted from the ROUTE ID as soon as the screen is focused — it does
          NOT wait on `show`. It used to gate on `show?.isLive`, and `show`
          comes from useShows(), which downloads the ENTIRE shows collection
          and then finds this one. That put a full-collection Firestore query
          in front of the token request, which is where most of the ~5s join
          delay came from. The server is the authority anyway: it answers
          SHOW_NOT_LIVE if the room isn't open, which ViewerStage surfaces. */}
      <View style={styles.stage}>
        {screenFocused && !showEnded ? (
          <ViewerStage
            key={stageEpoch}
            showId={String(id)}
            displayName={user?.displayName || user?.email?.split('@')[0] || undefined}
            posterUrl={show?.thumbnail || null}
            onLiveEvent={applyLiveEvent}
          />
        ) : show?.thumbnail ? (
          <Image source={{ uri: show.thumbnail }} style={styles.stageImage} contentFit="cover" />
        ) : (
          <View style={[styles.stageImage, { backgroundColor: c.backgroundElement }]} />
        )}
        <LinearGradient colors={SCRIM_TOP} style={styles.scrimTop} pointerEvents="none" />
        <LinearGradient colors={SCRIM_BOTTOM} style={styles.scrimBottom} pointerEvents="none" />
      </View>

      <SafeAreaView style={styles.content} edges={['top', 'bottom']}>
        {/* ── Header ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* Avatar + name open the seller's public profile — the uid rides
              along so the profile screen skips the username lookup. */}
          <Pressable
            onPress={() =>
              sellerUid &&
              router.push({
                pathname: '/user/[username]',
                params: { username: sellerHandle, uid: sellerUid },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`View ${sellerHandle}'s profile`}
            hitSlop={4}
            style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.7 }]}
          >
            {show?.thumbnail ? (
              <Image source={{ uri: show.thumbnail }} style={styles.avatarImg} contentFit="cover" />
            ) : (
              <Text style={styles.avatarText}>{sellerHandle.slice(0, 1).toUpperCase()}</Text>
            )}
          </Pressable>

          <View style={styles.headerText}>
            <Text
              numberOfLines={1}
              style={styles.sellerName}
              onPress={() =>
                sellerUid &&
                router.push({
                  pathname: '/user/[username]',
                  params: { username: sellerHandle, uid: sellerUid },
                })
              }
            >
              {sellerHandle}
            </Text>

            {/* Rating and ships-from only when the show doc actually carries
                them — an invented 4.8 next to a seller's name is exactly the
                kind of number a buyer would trust. */}
            <View style={styles.metaRow}>
              {rating !== null && (
                <>
                  <Ionicons name="star" size={12.5} color="#FFFFFF" />
                  <Text style={styles.metaText}>{rating.toFixed(1)}</Text>
                </>
              )}
              {rating !== null && !!secondary && <Text style={styles.metaDot}>·</Text>}
              {!!secondary && (
                <>
                  <Ionicons
                    name={shipsFrom ? 'cube-outline' : 'pricetag-outline'}
                    size={13}
                    color="#FFFFFF"
                  />
                  <Text style={[styles.metaText, { flexShrink: 1 }]} numberOfLines={1}>
                    {secondary}
                  </Text>
                </>
              )}

              {/* Real: writes a follows/{me}_{seller} row. Hidden on your own
                  show and while signed out, since neither can follow. */}
              {!!sellerUid && sellerUid !== user?.uid && (
                <Pressable
                  onPress={toggleFollow}
                  disabled={followBusy}
                  accessibilityRole="button"
                  accessibilityState={{ selected: following === true }}
                  accessibilityLabel={following ? 'Following' : 'Follow seller'}
                  style={({ pressed }) => [
                    styles.followBtn,
                    following && styles.followBtnOn,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.followText, following && styles.followTextOn]}>
                    {following ? 'Following' : 'Follow'}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* No presence system exists, so the count is "—", never invented. */}
          <View style={styles.viewers} accessibilityLabel="Viewers: not available">
            <Ionicons name="stats-chart" size={14} color="#FFFFFF" />
            <Text style={styles.viewersText}>—</Text>
          </View>

          <Pressable
            // Deep links and a cold start into a show leave nothing to go back
            // TO, and expo-router surfaced that as a red "The action 'GO_BACK'
            // was not handled" overlay with the buyer stuck in the room.
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
            accessibilityLabel="Close live show"
            style={styles.closeBtn}
            hitSlop={8}
          >
            <Ionicons name="chevron-down" size={24} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* ── Floating engagement card ───────────────────────────────── */}
        {giveaways.length > 0 && (
          <Pressable
            onPress={() => setRail('shop')}
            accessibilityRole="button"
            accessibilityLabel={`Giveaway: ${giveaways.length} item${giveaways.length === 1 ? '' : 's'}`}
            style={({ pressed }) => [styles.floatCard, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.floatTitle}>Giveaway</Text>
            <View style={styles.floatBody}>
              <Ionicons name="gift-outline" size={22} color="#FFFFFF" />
              <Text style={styles.floatNum}>{giveaways.length}</Text>
              <Text style={styles.floatLabel}>{giveaways.length === 1 ? 'Item' : 'Items'}</Text>
            </View>
          </Pressable>
        )}

        <KeyboardAvoidingView
          style={styles.lower}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* ── Chat (left) + action rail (right) ────────────────────── */}
          <View style={styles.midRow}>
            <View style={styles.chatCol}>
              {!chatHidden && !user && (
                <Pressable
                  onPress={() => requireAuth('chat', () => {})}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in to join the chat"
                  style={({ pressed }) => [styles.chatSignIn, pressed && { opacity: 0.8 }]}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={15} color="#FFFFFF" />
                  <Text style={styles.chatSignInText}>Sign in to watch and join the chat</Text>
                </Pressable>
              )}
              {!chatHidden && !!user && (
                <FlatList
                  ref={listRef}
                  data={messages}
                  keyExtractor={(_, i) => String(i)}
                  style={styles.chatList}
                  contentContainerStyle={styles.chatContent}
                  showsVerticalScrollIndicator={false}
                  onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                  renderItem={({ item }) => (
                    <View style={styles.msgRow}>
                      <View style={styles.msgAvatar}>
                        <Text style={styles.msgAvatarText}>
                          {(item.avatar || item.user).slice(0, 1).toLowerCase()}
                        </Text>
                      </View>
                      <View style={styles.msgBody}>
                        <Text style={styles.msgUser} numberOfLines={1}>
                          {item.user}
                        </Text>
                        <Text style={styles.msgText}>{item.text}</Text>
                      </View>
                    </View>
                  )}
                />
              )}
            </View>

            <View style={styles.rail}>
              <RailButton icon="ellipsis-horizontal" label="More" onPress={() => setRail('more')} />
              <RailButton
                icon="film-outline"
                label="Clip"
                dimmed
                onPress={() =>
                  setNotice('Clips aren’t built yet — saving a highlight needs recording on the server.')
                }
              />
              <RailButton icon="share-outline" label="Share" onPress={shareShow} />
              <RailButton icon="card-outline" label="Wallet" onPress={() => setRail('wallet')} />
              <RailButton
                icon="storefront-outline"
                label="Shop"
                thumbnail={railThumb}
                badge={products.length || undefined}
                onPress={() => setRail('shop')}
              />
            </View>
          </View>

          {/* Transient error/notice banner */}
          {!!notice && (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          )}

          {/* ── Composer ─────────────────────────────────────────────── */}
          <View style={styles.composerRow}>
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Say something..."
                placeholderTextColor="rgba(226,235,250,0.75)"
                style={styles.input}
                onSubmitEditing={handleSend}
                returnKeyType="send"
              />
            </View>

            {/* The reaction sits OUTSIDE the input as its own circle, as in the
                reference — the two actions stay visually separate. */}
            <Pressable
              onPress={draft.trim() ? handleSend : sendReaction}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={draft.trim() ? 'Send message' : 'Send a reaction'}
              style={({ pressed }) => [
                styles.reactBtn,
                draft.trim() ? styles.reactBtnSend : null,
                pressed && { opacity: 0.75 },
              ]}
            >
              <Ionicons
                name={draft.trim() ? 'arrow-up' : 'flame'}
                size={draft.trim() ? 22 : 24}
                color={draft.trim() ? '#FFFFFF' : '#FF7A2F'}
              />
            </Pressable>
          </View>

          {/* ── Bottom panel ─────────────────────────────────────────────
              Exactly ONE panel, like the reference: the live lot while an
              auction is running, otherwise the pinned Buy Now item. Stacking
              both made the bottom half of the screen a wall of cards. */}
          {auction ? (
            <AuctionPanel
              auction={auction}
              product={auctionProduct}
              myUid={user?.uid}
              blockedReason={blockedReason}
              blockedLabel={blockedLabel}
              ensureReady={ensureReady}
              onError={setNotice}
            />
          ) : spotlight ? (
            <ProductSpotlight
              product={spotlight}
              onBuy={() => openBuyNow(spotlight.id)}
              blockedReason={blockedReason}
              blockedLabel={blockedLabel}
            />
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ── Show ended ───────────────────────────────────────────────────
          The doc listener is the authority: isLive false with an endedAt stamp
          means the host closed the room. Without this, viewers were left on a
          frozen joining spinner forever. The stage above is already unmounted
          (showEnded gates it), which parks/releases the LiveKit room. */}
      {showEnded && (
        <View style={styles.endedOverlay}>
          <Ionicons name="radio-outline" size={42} color="rgba(255,255,255,0.9)" />
          <Text style={styles.endedTitle}>This show has ended</Text>
          <Text style={styles.endedBody}>
            {liveState?.replayUrl
              ? 'You can watch the replay right now.'
              : 'Thanks for watching — the seller has closed the room.'}
          </Text>
          {!!liveState?.replayUrl && (
            <Pressable
              onPress={() =>
                router.replace({
                  pathname: '/replay',
                  params: { url: liveState.replayUrl!, title: show?.name || 'Replay' },
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Watch the replay"
              style={({ pressed }) => [styles.endedBtn, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="play" size={16} color="#FFFFFF" />
              <Text style={styles.endedBtnText}>Watch replay</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
            accessibilityLabel="Leave the show"
            style={({ pressed }) => [
              styles.endedBtn,
              styles.endedBtnGhost,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.endedBtnText}>Back to shows</Text>
          </Pressable>
        </View>
      )}

      {/* More / Wallet / Shop — the rail's sheets. */}
      <Modal visible={rail !== null} transparent animationType="slide" onRequestClose={() => setRail(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRail(null)} accessibilityLabel="Close" />
        <View style={styles.railSheet}>
          <View style={styles.grabber} />

          {rail === 'more' && (
            <>
              <Text style={styles.railTitle}>More</Text>
              <Pressable
                onPress={() => {
                  setRail(null);
                  shareShow();
                }}
                accessibilityRole="button"
                accessibilityLabel="Share this show"
                style={({ pressed }) => [styles.railRow, pressed && { opacity: 0.75 }]}
              >
                <Ionicons name="share-outline" size={22} color="#7FB2FF" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.railRowTitle}>Share show</Text>
                  <Text style={styles.railRowBody}>Send the link to anyone.</Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color="rgba(159,180,216,0.6)" />
              </Pressable>

              <Pressable
                onPress={() => {
                  setChatHidden((h) => !h);
                  setRail(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={chatHidden ? 'Show chat' : 'Hide chat'}
                style={({ pressed }) => [styles.railRow, pressed && { opacity: 0.75 }]}
              >
                <Ionicons
                  name={chatHidden ? 'eye-outline' : 'eye-off-outline'}
                  size={22}
                  color="#7FB2FF"
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.railRowTitle}>{chatHidden ? 'Show chat' : 'Hide chat'}</Text>
                  <Text style={styles.railRowBody}>
                    Clears the messages off the video. Nothing is muted for anyone else.
                  </Text>
                </View>
              </Pressable>

              <Text style={styles.railNote}>
                Reporting a show or a buyer isn’t wired up yet — there’s no moderation queue behind
                it, so a report would go nowhere.
              </Text>
            </>
          )}

          {rail === 'wallet' && (
            <>
              <Text style={styles.railTitle}>Wallet</Text>
              <Pressable
                onPress={() => {
                  setRail(null);
                  setGetReadyOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Shipping address"
                style={({ pressed }) => [styles.railRow, pressed && { opacity: 0.75 }]}
              >
                <Ionicons name="cube-outline" size={22} color="#7FB2FF" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.railRowTitle}>Shipping</Text>
                  <Text style={styles.railRowBody} numberOfLines={2}>
                    {profile?.savedAddress
                      ? `Ship to ${profile.savedAddress.line1}, ${profile.savedAddress.city} ${profile.savedAddress.pincode}`
                      : 'No delivery address saved yet'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color="rgba(159,180,216,0.6)" />
              </Pressable>

              <Pressable
                onPress={() => {
                  setRail(null);
                  setGetReadyOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Payment method"
                style={({ pressed }) => [styles.railRow, pressed && { opacity: 0.75 }]}
              >
                <Ionicons name="card-outline" size={22} color="#7FB2FF" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.railRowTitle}>Payment</Text>
                  <Text style={styles.railRowBody}>
                    {profile?.preferredMethod ?? 'No payment preference saved yet'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color="rgba(159,180,216,0.6)" />
              </Pressable>

              <Text style={styles.railNote}>
                Referral credit and promo codes aren’t built yet — there’s no discount model on
                orders, so they’d have nothing to apply to.
              </Text>
            </>
          )}

          {rail === 'shop' && (
            <>
              <Text style={styles.railTitle}>Shop</Text>
              {products.length === 0 ? (
                <Text style={styles.railRowBody}>
                  This seller hasn’t added any items to the show yet.
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 380 }}>
                  {products.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setRail(null);
                        openBuyNow(p.id);
                      }}
                      disabled={p.kind === 'auction' || p.kind === 'giveaway'}
                      accessibilityRole="button"
                      accessibilityLabel={p.title}
                      style={({ pressed }) => [styles.railRow, pressed && { opacity: 0.75 }]}
                    >
                      {p.thumbnail_url ? (
                        <Image source={{ uri: p.thumbnail_url }} style={styles.shopThumb} contentFit="cover" />
                      ) : (
                        <View style={[styles.shopThumb, styles.shopThumbEmpty]}>
                          <Ionicons name="image-outline" size={18} color="rgba(159,180,216,0.6)" />
                        </View>
                      )}
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.railRowTitle} numberOfLines={1}>
                          {p.title}
                        </Text>
                        <Text style={styles.railRowBody}>
                          {p.kind === 'auction'
                            ? 'Auction lot'
                            : p.kind === 'giveaway'
                              ? 'Giveaway'
                              : formatPaise(p.price)}
                        </Text>
                      </View>
                      {p.kind !== 'auction' && p.kind !== 'giveaway' && (
                        <Ionicons name="chevron-forward" size={19} color="rgba(159,180,216,0.6)" />
                      )}
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </Modal>

      {/* One-time bid setup */}
      <GetReadySheet
        visible={getReadyOpen}
        profile={profile}
        onReady={() => {
          setGetReadyOpen(false);
          getCommerceProfile().then(setProfile).catch(() => {});
          setNotice('You’re all set — tap Bid again to place your bid.');
        }}
        onClose={() => setGetReadyOpen(false)}
      />

      {/* Winner payment — bound to THIS user's unpaid win wherever it sits in
          the list, so the seller starting the next lot can't dismiss it. */}
      {wonAuction && (
        <WinnerPaymentSheet
          auction={wonAuction}
          profile={profile}
          onDone={() => setDismissedWinFor(wonAuction.id)}
        />
      )}

      {/* Buy Now */}
      {buyingProduct && (
        <BuyNowSheet
          visible={!buyOrder}
          product={buyingProduct}
          address={profile?.savedAddress || null}
          onEditAddress={() => setGetReadyOpen(true)}
          onOrderCreated={(order) => setBuyOrder(order)}
          onClose={() => setBuyingProductId(null)}
        />
      )}
      <RazorpayCheckout
        visible={!!buyOrder}
        order={buyOrder}
        description={buyOrder?.productTitle || 'Any&All order'}
        prefill={{
          name: user?.displayName || undefined,
          email: user?.email || undefined,
          contact: profile?.savedAddress?.phone || undefined,
        }}
        preferredMethod={profile?.preferredMethod || undefined}
        onSuccess={() => {
          setBuyOrder(null);
          setBuyingProductId(null);
          setNotice('Payment confirmed — it’s yours! Track it under Orders.');
        }}
        onDismiss={() => {
          setBuyOrder(null);
          setNotice('Payment cancelled — your reservation will release shortly.');
        }}
        onError={(message) => {
          setBuyOrder(null);
          setNotice(message);
        }}
      />
    </View>
  );
}

/** One rail entry: a bare icon (or a product tile) with its label underneath.
 *  The reference has no button chrome here — the icons sit straight on the
 *  video and stay legible on a bright frame via a drop shadow. */
function RailButton({
  icon,
  label,
  onPress,
  badge,
  thumbnail,
  dimmed,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  badge?: number;
  thumbnail?: string | null;
  /** Present in the design but not backed by anything yet — shown at half
   *  strength and explains itself when tapped. */
  dimmed?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.railItem, dimmed && { opacity: 0.45 }, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.railIconBox}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.railThumb} contentFit="cover" />
        ) : (
          <Ionicons name={icon} size={29} color="#FFFFFF" style={styles.railIcon} />
        )}
        {!!badge && (
          <View style={styles.railBadge}>
            <Text style={styles.railBadgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.railLabel}>{label}</Text>
    </Pressable>
  );
}

/** Anything floating on live video needs its own contrast — the frame behind
 *  it changes every second, so a colour that works now can vanish next shot. */
const SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.85)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
} as const;

const styles = StyleSheet.create({
  root: { flex: 1 },
  stage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  stageImage: { width: '100%', height: '100%' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '22%' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '52%' },

  content: { flex: 1 },
  lower: { flex: 1, justifyContent: 'flex-end' },

  // ── Header ────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two + Spacing.one,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(46,107,255,0.28)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: '#FFFFFF', fontSize: 19, fontFamily: Fonts.sansSemiBold },
  headerText: { flex: 1, gap: 3 },
  sellerName: { color: '#FFFFFF', fontSize: 17, fontFamily: Fonts.sansSemiBold, ...SHADOW },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { color: '#FFFFFF', fontSize: 13, fontFamily: Fonts.sansSemiBold, ...SHADOW },
  metaDot: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontFamily: Fonts.sansSemiBold },
  followBtn: {
    marginLeft: 6,
    borderRadius: 999,
    paddingHorizontal: 15,
    height: 29,
    justifyContent: 'center',
    backgroundColor: '#2E6BFF',
  },
  followBtnOn: {
    backgroundColor: 'rgba(10,20,40,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  followText: { color: '#FFFFFF', fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  followTextOn: { color: '#FFFFFF' },
  viewers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#E5484D',
    paddingHorizontal: 13,
    height: 38,
  },
  viewersText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.sansSemiBold },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,26,44,0.7)',
  },

  // ── Floating engagement card ──────────────────────────────────────────
  floatCard: {
    alignSelf: 'flex-end',
    marginTop: Spacing.four + Spacing.two,
    minWidth: 165,
    backgroundColor: 'rgba(24,32,52,0.66)',
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    paddingVertical: Spacing.two + Spacing.one,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.three,
    gap: 6,
  },
  floatTitle: { color: '#FFFFFF', fontSize: 20, fontFamily: Fonts.sansSemiBold, ...SHADOW },
  floatBody: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  floatNum: { color: '#FFFFFF', fontSize: 20, fontFamily: Fonts.sansSemiBold },
  floatLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontFamily: Fonts.sans },

  // ── Chat + rail ───────────────────────────────────────────────────────
  midRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  chatCol: { flex: 1 },
  chatList: { maxHeight: 260, flexGrow: 0 },
  chatContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two + Spacing.one,
  },
  msgRow: { flexDirection: 'row', gap: Spacing.two + 2, alignItems: 'flex-start' },
  msgAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(24,36,64,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgAvatarText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.sansSemiBold },
  msgBody: { flex: 1, gap: 1 },
  // Chat floats over live video, so it carries its own shadow rather than a
  // panel — a solid backdrop would hide the item the seller is showing.
  msgUser: { fontSize: 14, fontFamily: Fonts.sansSemiBold, color: 'rgba(214,224,242,0.9)', ...SHADOW },
  msgText: { fontSize: 15.5, fontFamily: Fonts.sansSemiBold, lineHeight: 20, color: '#FFFFFF', ...SHADOW },

  rail: { alignItems: 'center', gap: Spacing.three + 2, paddingRight: Spacing.three, paddingBottom: Spacing.two },
  railItem: { alignItems: 'center', gap: 4, width: 60 },
  railIconBox: { alignItems: 'center', justifyContent: 'center' },
  railIcon: { ...SHADOW },
  railThumb: { width: 44, height: 44, borderRadius: 9 },
  railLabel: { color: '#FFFFFF', fontSize: 12.5, fontFamily: Fonts.sansSemiBold, ...SHADOW },
  railBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2E6BFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  railBadgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: Fonts.sansSemiBold },

  // ── Composer ──────────────────────────────────────────────────────────
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two + Spacing.one,
  },
  composer: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    borderRadius: 999,
    paddingHorizontal: Spacing.three + 2,
    height: 52,
    justifyContent: 'center',
  },
  input: { color: '#FFFFFF', fontSize: 16, fontFamily: Fonts.sans, padding: 0 },
  reactBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactBtnSend: { backgroundColor: '#2E6BFF', borderColor: '#2E6BFF' },

  // ── Guest chat prompt ─────────────────────────────────────────────────
  chatSignIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    marginLeft: Spacing.three,
    marginBottom: Spacing.two,
    backgroundColor: 'rgba(18,26,44,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  chatSignInText: { color: '#FFFFFF', fontSize: 13, fontFamily: Fonts.sansSemiBold },

  // ── Ended overlay ─────────────────────────────────────────────────────
  endedOverlay: {
    ...(StyleSheet.absoluteFill as object),
    backgroundColor: 'rgba(3,7,18,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.five,
  },
  endedTitle: { color: '#FFFFFF', fontSize: 22, fontFamily: Fonts.sansSemiBold, textAlign: 'center' },
  endedBody: {
    color: 'rgba(214,224,242,0.85)',
    fontSize: 14,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    lineHeight: 20,
  },
  endedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 200,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: '#2E6BFF',
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.one,
  },
  endedBtnGhost: {
    backgroundColor: 'rgba(18,26,44,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  endedBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.sansSemiBold },

  notice: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    borderWidth: 1,
    borderRadius: 10,
    borderColor: 'rgba(230,57,70,0.5)',
    backgroundColor: 'rgba(230,57,70,0.18)',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  noticeText: { color: '#FFFFFF', fontSize: 13, fontFamily: Fonts.sans },

  // ── Sheets ────────────────────────────────────────────────────────────
  backdrop: { ...(StyleSheet.absoluteFill as object), backgroundColor: 'rgba(2,6,16,0.6)' },
  railSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '75%',
    backgroundColor: '#0C1730',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: 'rgba(74,143,229,0.28)',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,150,210,0.35)',
    alignSelf: 'center',
  },
  railTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontFamily: Fonts.sansSemiBold,
    textAlign: 'center',
    marginBottom: Spacing.one,
  },
  railRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one, minHeight: 66 },
  railRowTitle: { color: '#FFFFFF', fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  railRowBody: { color: 'rgba(159,180,216,0.9)', fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },
  railNote: {
    color: 'rgba(159,180,216,0.55)',
    fontSize: 11.5,
    fontFamily: Fonts.sans,
    lineHeight: 16,
    paddingTop: Spacing.one,
  },
  shopThumb: { width: 48, height: 48, borderRadius: 8 },
  shopThumbEmpty: {
    backgroundColor: 'rgba(20,36,70,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
