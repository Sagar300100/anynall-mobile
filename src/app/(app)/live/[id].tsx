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
import type { Room } from 'livekit-client';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
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
import { BuyNowSheet, clearBuyNowIntent } from '@/components/buy-now-sheet';
import { GetReadySheet } from '@/components/get-ready-sheet';
import { LiveChat } from '@/components/live-chat';
import {
  availableUnits,
  flashClock,
  pickSpotlight,
  ProductSpotlight,
  useFlashSale,
} from '@/components/product-spotlight';
import { RazorpayCheckout } from '@/components/razorpay-checkout';
import { useBrandColors } from '@/components/ui/form';
import { ViewerStage } from '@/components/viewer-stage';
import { WinnerPaymentSheet } from '@/components/winner-payment-sheet';
import { Fonts, Spacing } from '@/constants/theme';
import { useScreenFocused } from '@/hooks/use-screen-focused';
import { useViewerCount } from '@/hooks/use-viewer-count';
import { useAuthGate } from '@/lib/auth-gate';
import { sendMessage } from '@/lib/chat';
import { db } from '@/lib/firebase';
import {
  cancelFollowRequest,
  followUser,
  getFollowStatus,
  unfollowUser,
  type FollowStatus,
} from '@/lib/follows';
import {
  canBuyFromShow,
  createTipOrder,
  formatPaise,
  getCommerceProfile,
  isReadyToBid,
  makeOffer,
  OFFER_MIN_RATIO,
  TIP_MAX_PAISE,
  TIP_MIN_PAISE,
  type AuctionRecord,
  type BuyEligibility,
  type BuyNowOrder,
  type CommerceProfile,
} from '@/lib/commerce';
import { discountAmountPaise } from '@/lib/credits';
import { subscribe as engineSubscribe, type EngineAuction } from '@/lib/auction-socket';
import { enterGiveaway, entryCount, hasEntered, isPermissionDenied } from '@/lib/giveaways';
import type { LiveEvent } from '@/lib/live-bus';
import { listenAuctions, listenProducts, type ProductDoc } from '@/lib/realtime';
import { serverMessage } from '@/lib/seller-hub';
import { useSession } from '@/lib/session';
import { useShows } from '@/hooks/use-shows';

/** The reference dims the video only at the very top and the very bottom, so
 *  the item the seller is holding stays bright in the middle. A flat wash over
 *  the whole frame (what this used to do) greyed out the product. */
const SCRIM_TOP = ['rgba(3,7,18,0.85)', 'rgba(3,7,18,0)'] as const;
const SCRIM_BOTTOM = ['rgba(3,7,18,0)', 'rgba(3,7,18,0.55)', 'rgba(3,7,18,0.92)'] as const;

type RailSheet = 'wallet' | 'shop' | 'more';

/** Reaction WRITE coalescing window. Every tap animates locally for free; a
 *  Firestore 🔥 message — a write fanned out to every viewer in the room —
 *  goes out on the FIRST tap of a window (leading edge), and taps 2..N
 *  coalesce into ONE more write when the window closes (trailing edge), which
 *  re-arms the window. Sustained tapping therefore costs about one write per
 *  window per device, without the room ever losing a burst entirely. */
const REACTION_WRITE_GAP_MS = 8000;

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

  // Chat lives entirely inside <LiveChat> — this screen deliberately holds NO
  // message state, so a chat flood can't re-render the header, the rail, the
  // auction panel or the video overlays. Only the composer is owned here.
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

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
  // Follow + the right rail's sheets. null = relationship not loaded yet;
  // 'requested' = pending follow request to a private seller.
  const [followState, setFollowState] = useState<FollowStatus | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [rail, setRail] = useState<RailSheet | null>(null);
  // More → Hide chat. Local only; the messages keep streaming underneath.
  const [chatHidden, setChatHidden] = useState(false);
  // ── Gap 8: giveaway entries, tips, offers ──
  // Per-giveaway entry state: has THIS user entered, and how many entries the
  // count aggregate reports. count === null means the aggregate read failed
  // (e.g. rules not deployed yet) — rendered as nothing, never as a fake zero.
  const [giveawayInfo, setGiveawayInfo] = useState<
    Record<string, { entered: boolean; count: number | null }>
  >({});
  const [enteringId, setEnteringId] = useState<string | null>(null);
  // Tips mirror buy-now exactly: amount sheet → server-created Razorpay order
  // (same checkout order shape) → RazorpayCheckout on tipOrder.
  const [tipOpen, setTipOpen] = useState(false);
  const [tipOrder, setTipOrder] = useState<BuyNowOrder | null>(null);
  // Make-an-offer sheet, keyed by product id the way buy-now is.
  const [offerProductId, setOfferProductId] = useState<string | null>(null);
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
  // The LiveKit room ViewerStage is holding — the presence source for the
  // header's viewer pill. Set once per stage mount (null when the stage is
  // down), so this state changes on stage lifecycle, never per viewer join:
  // joins/leaves are the PILL's state (see ViewerCountPill below).
  const [stageRoom, setStageRoom] = useState<Room | null>(null);

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
      const state = await getFollowStatus(sellerUid);
      if (!cancelled) setFollowState(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [sellerUid]);

  async function toggleFollow() {
    if (!sellerUid || followBusy) return;
    const prev = followState ?? 'none';
    setFollowBusy(true);
    try {
      if (prev === 'following') {
        setFollowState('none'); // optimistic; rolled back below
        await unfollowUser(sellerUid);
      } else if (prev === 'requested') {
        setFollowState('none'); // optimistic; withdraws the pending request
        await cancelFollowRequest(sellerUid);
      } else {
        // Not optimistic: a private seller yields 'requested', a public one
        // 'following' — we only know which once the lib resolves.
        setFollowState(await followUser(sellerUid));
      }
    } catch {
      setFollowState(prev);
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

  /** The reaction still sends a real chat message — there is no separate
   *  reactions channel, so web viewers keep seeing the 🔥 they always did.
   *  But the FEEL and the WRITE are decoupled: every tap fires the local
   *  floating flame immediately (only the overlay re-renders — its state is
   *  its own), while the Firestore write, a fan-out to every viewer in the
   *  room, coalesces per REACTION_WRITE_GAP_MS — leading edge plus ONE
   *  trailing-edge catch-up for taps suppressed inside the window. Purely
   *  leading-edge (the old shape) made taps 2..N vanish server-side: a
   *  20-tap flurry read as a single 🔥 to everyone else in the room. */
  const reactionsRef = useRef<ReactionOverlayHandle>(null);
  const lastReactionWriteAt = useRef(0);
  // Armed by the first suppressed tap of a window; fires one catch-up write
  // when the window closes (which re-arms the window).
  const trailingReaction = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Un-arm the trailing timer when the room unmounts — a queued catch-up
  // must not write into a show the buyer has already left.
  useEffect(() => {
    return () => {
      if (trailingReaction.current) {
        clearTimeout(trailingReaction.current);
        trailingReaction.current = null;
      }
    };
  }, []);

  /** The actual 🔥 write, shared by the leading and trailing edges. The
   *  window clock is stamped optimistically (so taps landing while the write
   *  is in flight coalesce into the trailing edge instead of double-writing)
   *  but ROLLED BACK on failure: a write that never reached the room must not
   *  consume the window — the next tap retries immediately instead of being
   *  silently muted for the rest of it. */
  async function writeReaction() {
    const stamp = Date.now();
    lastReactionWriteAt.current = stamp;
    try {
      await sendMessage(String(id), {
        user: user?.displayName || user?.email?.split('@')[0] || 'buyer',
        text: '🔥',
      });
    } catch {
      /* transient; the chat listener is the source of truth */
      if (lastReactionWriteAt.current === stamp) lastReactionWriteAt.current = 0;
    }
  }

  async function sendReaction() {
    if (!user) {
      requireAuth('chat', () => {});
      return;
    }
    // Animate NOW — the tap must feel instant regardless of what gets written.
    reactionsRef.current?.burst();
    const remaining = REACTION_WRITE_GAP_MS - (Date.now() - lastReactionWriteAt.current);
    if (remaining > 0) {
      // Inside the window: suppress the write, but remember the tap — ONE
      // trailing-edge 🔥 goes out when the window closes so the burst is
      // never lost entirely.
      if (!trailingReaction.current) {
        trailingReaction.current = setTimeout(() => {
          trailingReaction.current = null;
          void writeReaction();
        }, remaining);
      }
      return;
    }
    await writeReaction();
  }

  useEffect(() => {
    if (!id) return;
    // ── Two-lane reconciliation: the Firestore lane ──
    //
    // Auction state reaches setAuctions on two lanes: the engine socket
    // (below — per-bid frames, merged by `version`) and this Firestore
    // listener. The engine's steady-state flush to Firestore runs at ~1s and
    // its backpressure may SKIP socket frames, relying on this snapshot to
    // reconcile — so a snapshot can be up to ~1s behind what the socket
    // already delivered. Replacing the whole array here (the old raw
    // setAuctions) let that stale snapshot stomp newer socket state:
    // price/leader/endsAt regressed, the quick-bid button computed a too-low
    // minNext (BID_TOO_LOW), and a regressed endsAt re-armed the finalize
    // poll. So this lane merges by the SAME version counter the socket lane
    // uses — whichever lane is newer wins, and the two can never fight:
    //   • a doc we don't hold yet → take it (only Firestore announces lots);
    //   • doc version >= held → Firestore is newer or equal — take it;
    //   • status !== 'open' → take it regardless of version: a SETTLED doc
    //     is the server's decision (winner, payment window), not a bid frame;
    //   • otherwise keep the socket lane's bid fields on the fresh doc.
    const offAuctions = listenAuctions(String(id), (incoming) =>
      setAuctions((prev) =>
        incoming.map((fsDoc) => {
          const held = prev.find((h) => h.id === fsDoc.id);
          if (!held) return fsDoc;
          if ((fsDoc.version || 0) >= (held.version || 0)) return fsDoc; // Firestore newer or equal wins
          if (fsDoc.status !== 'open') return fsDoc; // a SETTLED doc is authoritative regardless of version — the server decided
          return {
            ...fsDoc,
            currentBid: held.currentBid,
            currentBidderUid: held.currentBidderUid,
            currentBidderName: held.currentBidderName,
            bidCount: held.bidCount,
            endsAt: held.endsAt,
            version: held.version,
          };
        })
      )
    );
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
      // The engine says the lot closed the moment its clock hits zero — flip
      // it out of 'open' now instead of after settle + Firestore fan-out. The
      // frame carries no view or version, so only an auction still held as
      // 'open' flips; the settled doc (winner, payment window) lands via the
      // Firestore listener moments later and replaces this wholesale.
      onEnded: (auctionId) =>
        setAuctions((prev) =>
          prev.map((held) =>
            held.id === auctionId && held.status === 'open' ? { ...held, status: 'ended' } : held
          )
        ),
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
  const offerProduct = offerProductId
    ? products.find((p) => p.id === offerProductId) || null
    : null;

  // Real giveaways only — the count is items the seller actually listed as a
  // giveaway for this show.
  const giveaways = products.filter((p) => p.kind === 'giveaway');

  // Entry state per giveaway: my own entry doc (getDoc) + the entry count
  // (count aggregate — one read regardless of entries). Keyed on the SET of
  // giveaway ids, not the products array: the listener fires on every product
  // update and this must not re-read entries each time a price changes.
  const giveawayIds = giveaways
    .map((g) => g.id)
    .sort()
    .join(',');
  const myUid = user?.uid ?? null;
  useEffect(() => {
    if (!id || !giveawayIds) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      for (const pid of giveawayIds.split(',')) {
        const [entered, count] = await Promise.all([
          myUid ? hasEntered(String(id), pid).catch(() => false) : Promise.resolve(false),
          entryCount(String(id), pid).catch(() => null),
        ]);
        if (cancelled) return;
        setGiveawayInfo((prev) => {
          const cur = prev[pid];
          // An optimistic local entry (the write succeeded) must never be
          // reverted by a slower read racing it.
          const nextEntered = entered || !!cur?.entered;
          if (cur && cur.entered === nextEntered && cur.count === count) return prev;
          return { ...prev, [pid]: { entered: nextEntered, count } };
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, giveawayIds, myUid]);

  /** One-tap giveaway entry — a DIRECT Firestore create the rules constrain
   *  to the caller's own uid. Guests are gated exactly like buying. */
  async function enterGiveawayTap(productId: string) {
    if (!user) {
      requireAuth('buy', () => {});
      return;
    }
    if (enteringId) return;
    setEnteringId(productId);
    try {
      await enterGiveaway(String(id), productId);
      setGiveawayInfo((prev) => {
        const cur = prev[productId];
        return {
          ...prev,
          [productId]: {
            entered: true,
            count: cur?.count != null ? cur.count + 1 : null,
          },
        };
      });
      setNotice('You’re in! The seller draws the winner live.');
    } catch (err) {
      setNotice(
        isPermissionDenied(err)
          ? 'Giveaway entries aren’t switched on for this show yet.'
          : 'Couldn’t enter the giveaway — please try again.'
      );
    } finally {
      setEnteringId(null);
    }
  }

  const enteredCount = giveaways.filter((g) => giveawayInfo[g.id]?.entered).length;

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
            onRoom={setStageRoom}
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
                  accessibilityState={{
                    selected: followState === 'following' || followState === 'requested',
                  }}
                  accessibilityLabel={
                    followState === 'following'
                      ? 'Following'
                      : followState === 'requested'
                        ? 'Follow requested'
                        : 'Follow seller'
                  }
                  style={({ pressed }) => [
                    styles.followBtn,
                    (followState === 'following' || followState === 'requested') &&
                      styles.followBtnOn,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={styles.followText}>
                    {followState === 'following'
                      ? 'Following'
                      : followState === 'requested'
                        ? 'Requested'
                        : 'Follow'}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* LiveKit is the presence system: the connected room knows its
              participants, so this shows remoteParticipants + 1 while live and
              "—" whenever the stage isn't connected. Isolated like LiveChat —
              the count is the PILL's state, so a rush of joins re-renders this
              ~40pt pill and never the screen. */}
          <ViewerCountPill room={stageRoom} />

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
            {/* Entry state, honestly: only what this user has actually done. */}
            {enteredCount > 0 && (
              <Text style={styles.floatEntered}>
                {enteredCount === giveaways.length
                  ? 'Entered ✓'
                  : `Entered ${enteredCount} of ${giveaways.length}`}
              </Text>
            )}
          </Pressable>
        )}

        <KeyboardAvoidingView
          style={styles.lower}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* ── Chat (left) + action rail (right) ────────────────────── */}
          <View style={styles.midRow}>
            <View style={styles.chatCol}>
              {/* Self-contained: owns its subscription, buffering and state,
                  so message floods re-render the column and nothing else.
                  setNotice is passed directly — a setState function is
                  referentially stable, which the memo'd child requires. */}
              <LiveChat
                showId={String(id ?? '')}
                user={user}
                hidden={chatHidden}
                onNotice={setNotice}
              />
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

            {/* Floating 🔥 for every tap, anchored over the reaction circle.
                Its state is entirely its own (driven via the imperative ref),
                so a tap-happy buyer re-renders this overlay and nothing else. */}
            <ReactionOverlay ref={reactionsRef} />
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

              {/* Tip the seller — a real Razorpay payment (100% to the seller,
                  no fee), so it runs through the same checkout as buy-now. */}
              <Pressable
                onPress={() => {
                  if (!user) {
                    setRail(null);
                    requireAuth('buy', () => {});
                    return;
                  }
                  setRail(null);
                  setTipOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Tip the seller"
                style={({ pressed }) => [styles.railRow, pressed && { opacity: 0.75 }]}
              >
                <Ionicons name="heart-outline" size={22} color="#7FB2FF" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.railRowTitle}>Tip the seller</Text>
                  <Text style={styles.railRowBody}>
                    Say thanks with ₹10–₹10,000. Every rupee goes to the seller.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color="rgba(159,180,216,0.6)" />
              </Pressable>

              {/* Referral credit (spec Gap 6) — shown only when a real balance
                  exists on the commerce profile. No balance, no row. */}
              {(profile?.creditPaise ?? 0) > 0 && (
                <View
                  style={styles.railRow}
                  accessible
                  accessibilityLabel={`Credit balance ${formatPaise(profile?.creditPaise ?? 0)}`}
                >
                  <Ionicons name="gift-outline" size={22} color="#7FB2FF" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.railRowTitle}>
                      Credit: {formatPaise(profile?.creditPaise ?? 0)}
                    </Text>
                    <Text style={styles.railRowBody}>
                      Spend it at checkout with the “Use credit” toggle.
                    </Text>
                  </View>
                </View>
              )}

              <Text style={styles.railNote}>
                Promo codes aren’t built yet — referral credit is the only discount that exists,
                and it applies at checkout.
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
                  {products.map((p) => {
                    const info = giveawayInfo[p.id];
                    const isGiveaway = p.kind === 'giveaway';
                    const isBin = p.kind !== 'auction' && !isGiveaway;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => {
                          setRail(null);
                          openBuyNow(p.id);
                        }}
                        disabled={!isBin}
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
                          {p.kind === 'auction' ? (
                            <Text style={styles.railRowBody}>Auction lot</Text>
                          ) : isGiveaway ? (
                            <Text style={styles.railRowBody}>
                              {p.giveawayWinner
                                ? `Won by ${p.giveawayWinner.name}`
                                : `${info?.entered ? 'Entered ✓' : 'Giveaway'}${
                                    info?.count != null
                                      ? ` · ${info.count} ${info.count === 1 ? 'entry' : 'entries'}`
                                      : ''
                                  }`}
                            </Text>
                          ) : (
                            <ShopRowPrice product={p} />
                          )}
                        </View>

                        {/* Giveaway: one-tap entry, then the done state. */}
                        {isGiveaway && !p.giveawayWinner && (
                          info?.entered ? (
                            <Text style={styles.enteredText}>Entered ✓</Text>
                          ) : (
                            <Pressable
                              onPress={() => enterGiveawayTap(p.id)}
                              disabled={enteringId !== null}
                              accessibilityRole="button"
                              accessibilityLabel={`Enter the giveaway for ${p.title}`}
                              style={({ pressed }) => [
                                styles.enterBtn,
                                enteringId !== null && { opacity: 0.5 },
                                pressed && { opacity: 0.8 },
                              ]}
                            >
                              <Text style={styles.enterBtnText}>
                                {enteringId === p.id ? 'Entering…' : 'Enter'}
                              </Text>
                            </Pressable>
                          )
                        )}

                        {/* Buy It Now: make an offer, next to the buy chevron. */}
                        {isBin && availableUnits(p) > 0 && (
                          <Pressable
                            onPress={() =>
                              requireAuth('buy', () => {
                                setRail(null);
                                setOfferProductId(p.id);
                              })
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`Make an offer on ${p.title}`}
                            style={({ pressed }) => [styles.offerBtn, pressed && { opacity: 0.8 }]}
                          >
                            <Text style={styles.offerBtnText}>Offer</Text>
                          </Pressable>
                        )}
                        {isBin && (
                          <Ionicons name="chevron-forward" size={19} color="rgba(159,180,216,0.6)" />
                        )}
                      </Pressable>
                    );
                  })}
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
          creditPaise={profile?.creditPaise ?? 0}
          onEditAddress={() => setGetReadyOpen(true)}
          onOrderCreated={(order) => {
            setBuyOrder(order);
            // Server-confirmed savings (spec Gap 6) — announce the REAL
            // recorded amounts, never client-side estimates.
            const credit = order.creditApplied || 0;
            const firstBuy = discountAmountPaise(order.firstBuyDiscount);
            if (credit > 0 || firstBuy > 0) {
              const parts = [
                credit > 0 ? `${formatPaise(credit)} credit` : null,
                firstBuy > 0 ? `${formatPaise(firstBuy)} first-purchase discount` : null,
              ].filter(Boolean);
              setNotice(`${parts.join(' + ')} applied — Razorpay charges ${formatPaise(order.amount)}.`);
            }
          }}
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
          // Payment confirmed — the purchase INTENT is complete, so release
          // its idempotency key: the next buy of this product must mint a
          // fresh key instead of replaying this (now paid) order. This is the
          // ONLY boundary where the key is dropped — a dismissed or failed
          // checkout keeps it, so retries replay the same reservation.
          if (buyingProductId) clearBuyNowIntent(buyingProductId);
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

      {/* Tip the seller — the tip order is the SAME checkout shape as a
          buy-now order, so it drives its own RazorpayCheckout exactly the way
          buyOrder does. Only one of the two can be visible at a time. */}
      <TipSheet
        visible={tipOpen}
        showId={String(id)}
        onCreated={(order) => {
          setTipOpen(false);
          setTipOrder(order);
        }}
        onClose={() => setTipOpen(false)}
      />
      <RazorpayCheckout
        visible={!!tipOrder}
        order={tipOrder}
        description={tipOrder?.productTitle || 'Tip the seller'}
        prefill={{
          name: user?.displayName || undefined,
          email: user?.email || undefined,
          contact: profile?.savedAddress?.phone || undefined,
        }}
        preferredMethod={profile?.preferredMethod || undefined}
        onSuccess={() => {
          setTipOrder(null);
          setNotice('🎉 Tip sent — thank you!');
        }}
        onDismiss={() => {
          setTipOrder(null);
          setNotice('Tip cancelled — nothing was charged.');
        }}
        onError={(message) => {
          setTipOrder(null);
          setNotice(message);
        }}
      />

      {/* Make an offer on a Buy It Now item */}
      {offerProduct && (
        <OfferSheet product={offerProduct} onClose={() => setOfferProductId(null)} />
      )}
    </View>
  );
}

/** The header's viewer pill. The count is ITS state (useViewerCount), so
 *  participants joining and leaving re-render this pill and nothing else —
 *  the same isolation as LiveChat. memo + a stable `room` prop (set once per
 *  stage mount) keep the screen's 1s auction tick from touching it. The
 *  label stays honest: a number only while actually connected. */
const ViewerCountPill = memo(function ViewerCountPill({ room }: { room: Room | null }) {
  const count = useViewerCount(room);
  return (
    <View
      style={styles.viewers}
      accessibilityLabel={count === null ? 'Viewers: not available' : `Viewers: ${count}`}
    >
      <Ionicons name="stats-chart" size={14} color="#FFFFFF" />
      <Text style={styles.viewersText}>{count === null ? '—' : String(count)}</Text>
    </View>
  );
});

/** Rupees typed by a human → integer paise. Null when unusable. */
function rupeesToPaise(rupees: string): number | null {
  const n = Number(rupees.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const paise = Math.round(n * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

/** The price line of a Buy It Now shop-sheet row. While the product carries a
 *  running flash sale this becomes strikethrough-list + flash price + mm:ss —
 *  its OWN component so the 1s countdown tick re-renders one price line, not
 *  the whole sheet. */
function ShopRowPrice({ product }: { product: ProductDoc }) {
  const flash = useFlashSale(product);
  if (!flash) {
    return <Text style={styles.railRowBody}>{formatPaise(product.price || 0)}</Text>;
  }
  return (
    <View style={styles.flashRow}>
      <Text style={[styles.railRowBody, styles.flashStrike]}>
        {formatPaise(product.price || 0)}
      </Text>
      <Text style={styles.flashRowPrice}>{formatPaise(flash.pricePaise)}</Text>
      <View style={styles.flashRowChip}>
        <Ionicons name="flash" size={11} color="#FFD166" />
        <Text style={styles.flashRowChipText}>{flashClock(flash.msLeft)}</Text>
      </View>
    </View>
  );
}

/** Preset tip amounts, in paise (₹10 / ₹50 / ₹100). */
const TIP_PRESETS = [1_000, 5_000, 10_000] as const;

/** Pick-an-amount sheet for tipping the seller. The server prices nothing
 *  here — it validates the bounds again and mints the Razorpay order; this
 *  sheet only keeps obviously-invalid amounts from spending a request. */
function TipSheet({
  visible,
  showId,
  onCreated,
  onClose,
}: {
  visible: boolean;
  showId: string;
  /** The created order — the parent opens RazorpayCheckout with it. */
  onCreated: (order: BuyNowOrder) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | 'custom'>(TIP_PRESETS[0]);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amountPaise = selected === 'custom' ? rupeesToPaise(custom) : selected;
  const valid =
    amountPaise != null && amountPaise >= TIP_MIN_PAISE && amountPaise <= TIP_MAX_PAISE;

  async function send() {
    if (!valid || amountPaise == null || busy) return;
    setBusy(true);
    setErr(null);
    try {
      onCreated(await createTipOrder(showId, amountPaise));
    } catch (e) {
      // The endpoint ships in the backend wave — until then this is the
      // honest failure, with the server's own sentence once it exists.
      setErr(serverMessage(e, 'Couldn’t start the tip — please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.railSheet}>
        <View style={styles.grabber} />
        <Text style={styles.railTitle}>Tip the seller</Text>
        <Text style={styles.railRowBody}>
          100% goes to the seller — Any&All takes no fee on tips.
        </Text>

        <View style={styles.tipRow}>
          {TIP_PRESETS.map((p) => {
            const on = selected === p;
            return (
              <Pressable
                key={p}
                onPress={() => setSelected(p)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Tip ${formatPaise(p)}`}
                style={({ pressed }) => [
                  styles.tipPill,
                  on && styles.tipPillOn,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={styles.tipPillText}>{formatPaise(p)}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setSelected('custom')}
            accessibilityRole="radio"
            accessibilityState={{ selected: selected === 'custom' }}
            accessibilityLabel="Custom tip amount"
            style={({ pressed }) => [
              styles.tipPill,
              selected === 'custom' && styles.tipPillOn,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.tipPillText}>Custom</Text>
          </Pressable>
        </View>

        {selected === 'custom' && (
          <View style={styles.amountBox}>
            <Text style={styles.amountRupee}>₹</Text>
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder="Amount (₹10–₹10,000)"
              placeholderTextColor="rgba(159,180,216,0.55)"
              keyboardType="number-pad"
              style={styles.amountInput}
              accessibilityLabel="Custom tip amount in rupees"
            />
          </View>
        )}

        {selected === 'custom' && custom.trim().length > 0 && !valid && (
          <Text style={styles.sheetHint}>Tips are between ₹10 and ₹10,000.</Text>
        )}
        {!!err && <Text style={styles.sheetError}>{err}</Text>}

        <Pressable
          onPress={send}
          disabled={!valid || busy}
          accessibilityRole="button"
          accessibilityLabel="Send tip"
          accessibilityState={{ disabled: !valid || busy }}
          style={({ pressed }) => [
            styles.sheetPrimaryBtn,
            (!valid || busy) && { opacity: 0.5 },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.sheetPrimaryText}>
            {busy
              ? 'Starting…'
              : valid && amountPaise != null
                ? `Tip ${formatPaise(amountPaise)}`
                : 'Tip'}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** Make an offer on an active Buy It Now product. Client-validates the
 *  spec's 40–100%-of-list window before spending a request; the server
 *  enforces it again, plus "one open offer per buyer per product" (its 409
 *  message is shown verbatim). */
function OfferSheet({ product, onClose }: { product: ProductDoc; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const list = product.price || 0;
  const minPaise = Math.ceil(list * OFFER_MIN_RATIO);
  const paise = rupeesToPaise(amount);
  const valid = paise != null && paise >= minPaise && paise <= list;

  async function submit() {
    if (!valid || paise == null || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await makeOffer(product.id, paise);
      setSent(true);
    } catch (e) {
      setErr(serverMessage(e, 'Couldn’t send the offer — please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.railSheet}>
        <View style={styles.grabber} />
        <Text style={styles.railTitle}>Make an offer</Text>
        <Text style={styles.railRowBody} numberOfLines={2}>
          {product.title} · listed at {formatPaise(list)}
        </Text>

        {sent ? (
          <>
            <Text style={styles.offerSentTitle}>Offer sent ✓</Text>
            <Text style={styles.railRowBody}>
              The seller has 24 hours to accept or decline. If they accept, you’ll get 30
              minutes to pay at your offer price.
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Done"
              style={({ pressed }) => [styles.sheetPrimaryBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.sheetPrimaryText}>Done</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.amountBox}>
              <Text style={styles.amountRupee}>₹</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder={`${Math.ceil(minPaise / 100)}–${Math.floor(list / 100)}`}
                placeholderTextColor="rgba(159,180,216,0.55)"
                keyboardType="number-pad"
                style={styles.amountInput}
                accessibilityLabel="Offer amount in rupees"
              />
            </View>
            <Text style={styles.sheetHint}>
              Offers must be between {formatPaise(minPaise)} and {formatPaise(list)}. One
              open offer per item.
            </Text>
            {!!err && <Text style={styles.sheetError}>{err}</Text>}
            <Pressable
              onPress={submit}
              disabled={!valid || busy}
              accessibilityRole="button"
              accessibilityLabel="Send offer"
              accessibilityState={{ disabled: !valid || busy }}
              style={({ pressed }) => [
                styles.sheetPrimaryBtn,
                (!valid || busy) && { opacity: 0.5 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.sheetPrimaryText}>
                {busy
                  ? 'Sending…'
                  : valid && paise != null
                    ? `Offer ${formatPaise(paise)}`
                    : 'Send offer'}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
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

/** Imperative surface for the reaction overlay: the tap handler calls
 *  burst() through a ref, so tapping never routes through screen state. */
interface ReactionOverlayHandle {
  burst: () => void;
}

/** The floating 🔥 shower over the composer's reaction circle.
 *
 *  Self-contained on purpose: its burst list is ITS state, driven through the
 *  imperative handle, so a flurry of taps re-renders this ~52pt overlay and
 *  never the screen. Honours reduced motion (AccessibilityInfo) by fading in
 *  place instead of travelling. */
const ReactionOverlay = forwardRef<ReactionOverlayHandle>(function ReactionOverlay(_props, ref) {
  const [bursts, setBursts] = useState<{ id: number; drift: number }[]>([]);
  const nextId = useRef(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => !cancelled && setReduceMotion(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      burst: () => {
        const id = nextId.current++;
        // Sideways scatter so rapid taps read as a shower, not one flame
        // redrawn in place. Capped so a button-masher can't accumulate an
        // unbounded pile of animated views.
        setBursts((prev) => [...prev.slice(-11), { id, drift: (Math.random() - 0.5) * 48 }]);
      },
    }),
    []
  );

  // Stable remover: an inline closure would change identity on every burst
  // and restart the in-flight animations' effects beneath it.
  const removeBurst = useCallback((id: number) => {
    setBursts((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return (
    <View style={styles.reactionOverlay} pointerEvents="none">
      {bursts.map((b) => (
        <FloatingFlame
          key={b.id}
          id={b.id}
          drift={b.drift}
          reduceMotion={reduceMotion}
          onDone={removeBurst}
        />
      ))}
    </View>
  );
});

/** One flame: rises and fades over ~900ms, then removes itself. With reduced
 *  motion it stays put and simply fades — feedback without travel. */
function FloatingFlame({
  id,
  drift,
  reduceMotion,
  onDone,
}: {
  id: number;
  /** Horizontal scatter in px, fixed at burst time. */
  drift: number;
  reduceMotion: boolean;
  onDone: (id: number) => void;
}) {
  // useState, not the useRef(...).current idiom: the strict hooks lint reads
  // that as a ref access during render. The initializer runs once per mount,
  // which is exactly the lifetime one flame needs.
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 650 : 900,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) onDone(id);
    });
    return () => anim.stop();
  }, [progress, reduceMotion, onDone, id]);

  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 0.72, 1],
    outputRange: [0, 1, 1, 0],
  });
  const animatedStyle = reduceMotion
    ? { opacity }
    : {
        opacity,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -132] }) },
          { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, drift] }) },
          {
            scale: progress.interpolate({
              inputRange: [0, 0.25, 1],
              outputRange: [0.6, 1.15, 0.9],
            }),
          },
        ],
      };

  return (
    <Animated.Text style={[styles.reactionFlame, animatedStyle]} accessible={false}>
      🔥
    </Animated.Text>
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
  floatEntered: { color: '#8CE8B4', fontSize: 13.5, fontFamily: Fonts.sansSemiBold },

  // ── Chat + rail ───────────────────────────────────────────────────────
  // The chat column's internals (list, rows, guest pill) live with LiveChat
  // in components/live-chat.tsx; only the column slot remains here.
  midRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  chatCol: { flex: 1 },

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

  // ── Reaction flames ───────────────────────────────────────────────────
  // Sized and positioned to sit exactly on the reaction circle (52pt, at the
  // composer row's right padding edge); flames rise out of it. pointerEvents
  // none, so the button underneath keeps every tap.
  reactionOverlay: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.two + Spacing.one,
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionFlame: { position: 'absolute', fontSize: 27 },

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

  // ── Giveaway entry (shop sheet) ───────────────────────────────────────
  enterBtn: {
    backgroundColor: '#2E6BFF',
    borderRadius: 999,
    paddingHorizontal: 16,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enterBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: Fonts.sansSemiBold },
  enteredText: { color: '#8CE8B4', fontSize: 13.5, fontFamily: Fonts.sansSemiBold },

  // ── Offers (shop sheet) ───────────────────────────────────────────────
  offerBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerBtnText: { color: '#FFFFFF', fontSize: 13, fontFamily: Fonts.sansSemiBold },
  offerSentTitle: { color: '#8CE8B4', fontSize: 17, fontFamily: Fonts.sansSemiBold },

  // ── Flash sale (shop sheet rows) ──────────────────────────────────────
  flashRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flashStrike: { textDecorationLine: 'line-through', color: 'rgba(159,180,216,0.6)' },
  flashRowPrice: { color: '#FFD166', fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  flashRowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,209,102,0.12)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  flashRowChipText: { color: '#FFD166', fontSize: 11.5, fontFamily: Fonts.sansSemiBold },

  // ── Tip + offer sheets ────────────────────────────────────────────────
  tipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tipPill: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 999,
    paddingHorizontal: 18,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipPillOn: { backgroundColor: '#2E6BFF', borderColor: '#2E6BFF' },
  tipPillText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.sansSemiBold },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    minHeight: 50,
  },
  amountRupee: { color: '#FFFFFF', fontSize: 16, fontFamily: Fonts.sansSemiBold },
  amountInput: { flex: 1, color: '#FFFFFF', fontSize: 16, fontFamily: Fonts.sans, padding: 0 },
  sheetHint: { color: 'rgba(159,180,216,0.9)', fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17 },
  sheetError: { color: '#FF8B8B', fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },
  sheetPrimaryBtn: {
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: '#2E6BFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
  },
  sheetPrimaryText: { color: '#FFFFFF', fontSize: 16, fontFamily: Fonts.sansSemiBold },
});
