// Live Listings — what the show room's Shop button opens.
//
// Everything on this screen is the seller's real data for THIS show:
//   • the tabs filter products genuinely attached to the show (showId)
//   • "Sold" reads each product's own sold count
//   • "Pending Payment" reads real orders from GET /api/orders/selling that
//     are still awaiting payment for this show
//   • the item count is the length of what is actually on screen
//
// PRE-BIDS is the one control with nothing behind it: there is no pre-bid
// concept anywhere in this backend — bids only exist against an open auction.
// It keeps its place in the tab row and says so rather than filtering to an
// empty list and implying the feature works.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateListing, type ListingMode } from '@/components/create-listing';
import { FieldBox, SheetHeader, TONE } from '@/components/listing-parts';
import { flashClock, useFlashSale } from '@/components/product-spotlight';
import { Fonts, Spacing } from '@/constants/theme';
import { createAuction, formatPaise } from '@/lib/commerce';
import { entryCount } from '@/lib/giveaways';
import {
  acceptOffer,
  attachProductToShow,
  declineOffer,
  detachProductFromShow,
  drawGiveawayWinner,
  FLASH_MINUTES_MAX,
  FLASH_MINUTES_MIN,
  getMyProducts,
  getOpenOffers,
  getSellingOrders,
  pinProduct,
  serverMessage,
  setFlashSale,
  unpinProduct,
  type OfferRecord,
  type SellerProduct,
  type SellingOrder,
} from '@/lib/seller-hub';
import { serverNow } from '@/lib/server-time';

type Tab = 'auction' | 'buy-it-now' | 'giveaway' | 'offers' | 'sold' | 'pending';

const TABS: { value: Tab; label: string }[] = [
  { value: 'auction', label: 'Auction' },
  { value: 'buy-it-now', label: 'Buy Now' },
  { value: 'giveaway', label: 'Giveaway' },
  { value: 'offers', label: 'Offers' },
  { value: 'sold', label: 'Sold' },
  { value: 'pending', label: 'Pending Payment' },
];

type Sort = 'newest' | 'price-asc' | 'price-desc';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
];

/** Orders that have not been paid for yet. `pending_payment` is what the
 *  backend actually writes when an order is created (ordersRouter buy-now,
 *  auctionsRouter winner order); `pending`/`created` stay as defensive
 *  aliases. Mirrors ORDER_STATUS's "Awaiting payment" entries — expired and
 *  failed payments are dead, not awaiting. */
const UNPAID = new Set(['pending', 'created', 'pending_payment']);

export function LiveListings({
  visible,
  showId,
  uid,
  isLive,
  onClose,
  onCountChange,
}: {
  visible: boolean;
  showId: string;
  uid: string | null;
  /** Whether the show is currently on air — the giveaway draw is an on-air
   *  action (the server announces the winner in chat), so the button only
   *  appears while live. */
  isLive?: boolean;
  onClose: () => void;
  /** Lets the show room's Shop badge stay honest after a listing is added. */
  onCountChange?: (n: number) => void;
}) {
  const insets = useSafeAreaInsets();

  const [products, setProducts] = useState<SellerProduct[] | null>(null);
  const [orders, setOrders] = useState<SellingOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const [tab, setTab] = useState<Tab>('auction');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [form, setForm] = useState<ListingMode | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState<string | null>(null);

  // ── Gap 8 state ──
  // Open offers on this seller's products. null = not loaded; a failed fetch
  // flips offersFailed so the tab says so instead of claiming "no offers".
  const [offers, setOffers] = useState<OfferRecord[] | null>(null);
  const [offersFailed, setOffersFailed] = useState(false);
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  // Giveaway entry counts (count aggregate). null = read failed (rules may
  // not be deployed) — shown as unknown, never as zero.
  const [entryCounts, setEntryCounts] = useState<Record<string, number | null>>({});
  const [drawing, setDrawing] = useState<string | null>(null);
  /** Winners drawn in THIS session, so the row updates before the products
   *  API starts returning giveawayWinner. */
  const [drawnLocal, setDrawnLocal] = useState<Record<string, string>>({});
  // Flash sales: the product being configured, and flashes started this
  // session (the products API may not return flashSale until the backend
  // wave lands — the server's own response is the honest source meanwhile).
  const [flashFor, setFlashFor] = useState<SellerProduct | null>(null);
  const [flashBusy, setFlashBusy] = useState<string | null>(null);
  const [localFlash, setLocalFlash] = useState<
    Record<string, { pricePaise: number; endsAt: string }>
  >({});

  /** Put a lot up for bidding. Price/step/duration come from the listing's own
   *  auction prefill when it has one, otherwise from its price. */
  async function startLot(p: SellerProduct) {
    if (starting) return;
    setStarting(p.id);
    try {
      await createAuction({
        productId: p.id,
        showId,
        startPrice: p.auctionConfig?.startPrice ?? p.price,
        bidStep: p.auctionConfig?.bidStep,
        durationSeconds: p.auctionConfig?.durationSeconds ?? 60,
        suddenDeath: p.auctionConfig?.suddenDeath,
      });
      onClose();
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : String(err);
      const m = text.match(/"message"\s*:\s*"([^"]+)"/);
      Alert.alert(
        'Couldn’t start this lot',
        m?.[1] ||
          (/AUCTION_ALREADY_OPEN/.test(text)
            ? 'Another lot is already running in this show. Let it finish first.'
            : 'Please try again.')
      );
    } finally {
      setStarting(null);
    }
  }

  /** Buy Now spotlight. The server keeps ONE pinned product per show —
   *  pinning unpins any sibling first, so this always replaces. The pinned
   *  flag rides the products listener every buyer already has. */
  async function togglePin(p: SellerProduct) {
    if (pinBusy) return;
    setPinBusy(p.id);
    try {
      if (p.pinned) await unpinProduct(p.id);
      else await pinProduct(p.id);
      // Reload rather than patch locally: pinning may have unpinned a sibling.
      await load();
    } catch (err) {
      Alert.alert('Couldn’t update the spotlight', serverMessage(err, 'Please try again.'));
    } finally {
      setPinBusy(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [p, o] = await Promise.all([getMyProducts(), getSellingOrders()]);
      const mine = p.products.filter((x) => x.showId === showId);
      setProducts(mine);
      setOrders(o.orders.filter((x) => x.showId === showId));
      onCountChange?.(mine.length);
    } catch {
      setProducts([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
    // Offers fail soft on their own: the endpoint ships in the backend wave,
    // and a 404 there must not take the listings down with it.
    try {
      const r = await getOpenOffers('seller', 'open');
      setOffers(Array.isArray(r.offers) ? r.offers : []);
      setOffersFailed(false);
    } catch {
      setOffers([]);
      setOffersFailed(true);
    }
  }, [showId, onCountChange]);

  // Entry counts for this show's giveaways — one aggregate read per giveaway,
  // keyed on the SET of giveaway ids so a price edit doesn't re-read them.
  const giveawayIds = (products ?? [])
    .filter((p) => p.kind === 'giveaway')
    .map((p) => p.id)
    .sort()
    .join(',');
  useEffect(() => {
    if (!visible || !giveawayIds) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      for (const pid of giveawayIds.split(',')) {
        const n = await entryCount(showId, pid).catch(() => null);
        if (cancelled) return;
        setEntryCounts((prev) => (prev[pid] === n ? prev : { ...prev, [pid]: n }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, giveawayIds, showId]);

  /** Draw the giveaway winner — server-side random pick that announces in
   *  chat and creates the zero-amount order, so it's confirmed first. */
  function confirmDraw(p: SellerProduct) {
    const n = entryCounts[p.id];
    Alert.alert(
      'Draw the winner?',
      `${
        n != null ? `One of ${n} ${n === 1 ? 'entry' : 'entries'}` : 'One entry'
      } is picked at random, announced in the chat, and gets a free order for shipping. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Draw winner', onPress: () => draw(p) },
      ]
    );
  }

  async function draw(p: SellerProduct) {
    if (drawing) return;
    setDrawing(p.id);
    try {
      const r = await drawGiveawayWinner(showId, p.id);
      setDrawnLocal((prev) => ({ ...prev, [p.id]: r.winner.name }));
      Alert.alert(
        '🎉 Winner drawn',
        `${r.winner.name} wins ${p.title}. It’s been announced in the chat, and a free order was created so you can ship it.`
      );
      load();
    } catch (err) {
      Alert.alert('Couldn’t draw a winner', serverMessage(err, 'Please try again.'));
    } finally {
      setDrawing(null);
    }
  }

  /** Accept creates a reserved order with a 30-minute payment window (the
   *  winner-order mechanics), so it gets a confirm; decline is instant. */
  function confirmAcceptOffer(o: OfferRecord) {
    Alert.alert(
      'Accept this offer?',
      `${o.buyerName || 'The buyer'} pays ${formatPaise(o.amountPaise)}${
        o.productTitle ? ` for ${o.productTitle}` : ''
      }. A reserved order is created and they get 30 minutes to pay.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept', onPress: () => actOnOffer(o, 'accept') },
      ]
    );
  }

  async function actOnOffer(o: OfferRecord, action: 'accept' | 'decline') {
    if (offerBusy) return;
    setOfferBusy(o.id);
    try {
      if (action === 'accept') {
        await acceptOffer(o.id);
        Alert.alert(
          'Order created',
          'The buyer has 30 minutes to pay at the offer price. Watch it under Pending Payment.'
        );
      } else {
        await declineOffer(o.id);
      }
      setOffers((prev) => (prev ?? []).filter((x) => x.id !== o.id));
      load();
    } catch (err) {
      Alert.alert(
        action === 'accept' ? 'Couldn’t accept the offer' : 'Couldn’t decline the offer',
        serverMessage(err, 'Please try again.')
      );
    } finally {
      setOfferBusy(null);
    }
  }

  /** End an active flash early — POST with minutes: 0. The spec only defines
   *  1–60, so the backend may refuse; the fallback message is honest about
   *  the sale lapsing on its own timer either way. */
  function confirmEndFlash(p: SellerProduct, pricePaise: number) {
    Alert.alert('End this flash sale early?', 'Buyers pay the normal list price again.', [
      { text: 'Keep it running', style: 'cancel' },
      { text: 'End now', onPress: () => endFlash(p, pricePaise) },
    ]);
  }

  async function endFlash(p: SellerProduct, pricePaise: number) {
    if (flashBusy) return;
    setFlashBusy(p.id);
    try {
      await setFlashSale(p.id, pricePaise, 0);
      setLocalFlash((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      await load();
    } catch (err) {
      Alert.alert(
        'Couldn’t end the flash sale',
        serverMessage(
          err,
          'Ending early isn’t supported yet — the sale will end on its own timer.'
        )
      );
    } finally {
      setFlashBusy(null);
    }
  }

  // Reload each time the sheet opens. The await defers the first setState out
  // of the effect body itself, which the compiler's purity rules require.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, load]);

  const term = q.trim().toLowerCase();
  const all = products ?? [];

  const matching = all.filter((p) => !term || p.title.toLowerCase().includes(term));
  const rows =
    tab === 'sold'
      ? matching.filter((p) => p.sold > 0)
      : tab === 'pending' || tab === 'offers'
        ? []
        : matching.filter((p) => p.kind === tab);

  const sorted = [...rows].sort((a, b) =>
    sort === 'price-asc' ? a.price - b.price : sort === 'price-desc' ? b.price - a.price : b.createdAtMs - a.createdAtMs
  );

  const pendingOrders = orders
    .filter((o) => UNPAID.has(o.status))
    .filter((o) => !term || o.productTitle.toLowerCase().includes(term));

  // Scoped to THIS show when the offer says which show it belongs to; an
  // offer without a showId (leaner backend response) still renders rather
  // than silently vanishing.
  const offerRows = (offers ?? [])
    .filter((o) => (o.showId ?? showId) === showId)
    .filter((o) => !term || (o.productTitle || '').toLowerCase().includes(term));

  const count =
    tab === 'pending' ? pendingOrders.length : tab === 'offers' ? offerRows.length : sorted.length;

  /** The category this seller most recently listed in — real, or ''. */
  const recentCategory = all.find((p) => !!p.category)?.category ?? '';

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close listings" />

      <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
        <SheetHeader title="Live Listings" onClose={onClose} />

        <View style={styles.search}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search..."
            placeholderTextColor={TONE.faint}
            style={styles.searchInput}
            accessibilityLabel="Search listings"
            autoCorrect={false}
          />
          {!!q && (
            <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={TONE.faint} />
            </Pressable>
          )}
        </View>

        {/* flexGrow: 0 — a horizontal ScrollView inside a flex column will
            otherwise stretch to fill the sheet. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsWrap}
          contentContainerStyle={styles.tabs}
        >
          {TABS.map((t) => {
            const on = t.value === tab;
            return (
              <Pressable
                key={t.value}
                onPress={() => setTab(t.value)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t.label}
                style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
                {on && <View style={styles.tabUnderline} />}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setSortOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Sort listings"
            style={({ pressed }) => [styles.filterBtn, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="options-outline" size={19} color={TONE.text} />
          </Pressable>

          {/* Inert on purpose — pre-bids don't exist in this backend. */}
          <Pressable
            onPress={() =>
              Alert.alert(
                'Pre-bids',
                'Bidding before a show starts isn’t built — bids only exist against an auction that is already open.'
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Pre-bids. Not available yet"
            style={({ pressed }) => [styles.preBids, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.preBidsText}>Pre-bids</Text>
          </Pressable>

          <View style={{ flex: 1 }} />
          <Text style={styles.count}>
            {count} {count === 1 ? 'Item' : 'Items'}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {loading && products === null ? (
            <ActivityIndicator color={TONE.primary} style={{ marginTop: Spacing.four }} />
          ) : tab === 'pending' ? (
            pendingOrders.length === 0 ? (
              <Empty
                message={failed ? 'Couldn’t load this show’s listings.' : 'Nothing is awaiting payment.'}
              />
            ) : (
              pendingOrders.map((o) => (
                <View key={o.id} style={styles.row}>
                  <View style={styles.rowThumbEmpty}>
                    <Ionicons name="time-outline" size={20} color={TONE.faint} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {o.productTitle}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {o.buyerName ? `${o.buyerName} · ` : ''}Awaiting payment
                    </Text>
                  </View>
                  <Text style={styles.rowPrice}>{formatPaise(o.amount)}</Text>
                </View>
              ))
            )
          ) : tab === 'offers' ? (
            offerRows.length === 0 ? (
              <Empty
                message={
                  offersFailed
                    ? 'Couldn’t load offers.'
                    : 'No open offers right now.\nOffers buyers make on your\nBuy Now items appear here.'
                }
              />
            ) : (
              offerRows.map((o) => (
                <View key={o.id} style={styles.row}>
                  <View style={styles.rowThumbEmpty}>
                    <Ionicons name="pricetags-outline" size={20} color={TONE.faint} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {o.productTitle || 'Offer'}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={2}>
                      {o.buyerName ? `${o.buyerName} · ` : ''}
                      {formatPaise(o.amountPaise)} offered
                      {o.listPricePaise ? ` · list ${formatPaise(o.listPricePaise)}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => actOnOffer(o, 'decline')}
                    disabled={offerBusy !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Decline the ${formatPaise(o.amountPaise)} offer`}
                    style={({ pressed }) => [
                      styles.declineBtn,
                      offerBusy !== null && { opacity: 0.5 },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    {offerBusy === o.id ? (
                      <ActivityIndicator color={TONE.text} size="small" />
                    ) : (
                      <Text style={styles.declineText}>Decline</Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => confirmAcceptOffer(o)}
                    disabled={offerBusy !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Accept the ${formatPaise(o.amountPaise)} offer`}
                    style={({ pressed }) => [
                      styles.startBtn,
                      offerBusy !== null && { opacity: 0.5 },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={styles.startText}>Accept</Text>
                  </Pressable>
                </View>
              ))
            )
          ) : sorted.length === 0 ? (
            <Empty
              message={
                failed
                  ? 'Couldn’t load this show’s listings.'
                  : term
                    ? `Nothing matches “${q.trim()}”.`
                    : 'There’s nothing here\nat the moment!'
              }
            />
          ) : (
            sorted.map((p) => {
              const winnerName = p.giveawayWinner?.name ?? drawnLocal[p.id] ?? null;
              const entries = entryCounts[p.id];
              // The product doc's flash (once the API returns it) or the one
              // started this session — whichever exists.
              const flashSale = p.flashSale ?? localFlash[p.id] ?? null;
              return (
              <View key={p.id} style={styles.row}>
                {p.thumbnail_url ? (
                  <Image source={{ uri: p.thumbnail_url }} style={styles.rowThumb} contentFit="cover" />
                ) : (
                  <View style={styles.rowThumbEmpty}>
                    <Ionicons name="image-outline" size={20} color={TONE.faint} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {p.title}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {p.temporary ? 'Temporary · ' : ''}
                    {tab === 'sold' ? `${p.sold} sold` : `${Math.max(0, p.stock - p.sold)} available`}
                    {p.auctionConfig?.suddenDeath ? ' · Sudden Death' : ''}
                    {p.pinned ? ' · Spotlight' : ''}
                    {p.kind === 'giveaway' && entries != null
                      ? ` · ${entries} ${entries === 1 ? 'entry' : 'entries'}`
                      : ''}
                    {winnerName ? ` · Won by ${winnerName}` : ''}
                  </Text>
                </View>
                <Text style={styles.rowPrice}>{p.kind === 'giveaway' ? 'Free' : formatPaise(p.price)}</Text>

                {/* Buy Now spotlight — POST /pin|/unpin. One per show: the
                    server unpins any sibling, so pinning always replaces.
                    Buyers' rooms feature the pinned item (pickSpotlight). */}
                {p.kind === 'buy-it-now' && tab === 'buy-it-now' && (
                  <Pressable
                    onPress={() => togglePin(p)}
                    disabled={pinBusy !== null}
                    accessibilityRole="button"
                    accessibilityState={{ selected: p.pinned }}
                    accessibilityLabel={
                      p.pinned
                        ? `Remove ${p.title} from the Buy Now spotlight`
                        : `Spotlight ${p.title} for Buy Now`
                    }
                    style={({ pressed }) => [
                      styles.pinBtn,
                      p.pinned && styles.pinBtnOn,
                      pinBusy !== null && { opacity: 0.5 },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    {pinBusy === p.id ? (
                      <ActivityIndicator color={p.pinned ? '#FFFFFF' : TONE.text} size="small" />
                    ) : (
                      <Ionicons
                        name={p.pinned ? 'star' : 'star-outline'}
                        size={18}
                        color={p.pinned ? '#FFFFFF' : TONE.text}
                      />
                    )}
                  </Pressable>
                )}

                {/* Flash sale — POST /api/products/:id/flash. Active flash
                    shows the countdown chip (tap to end early); otherwise
                    the bolt opens the price+minutes sheet. */}
                {p.kind === 'buy-it-now' && tab === 'buy-it-now' && (
                  <FlashCell
                    flashSale={flashSale}
                    busy={flashBusy === p.id}
                    onStart={() => setFlashFor(p)}
                    onEndEarly={(pricePaise) => confirmEndFlash(p, pricePaise)}
                  />
                )}

                {/* Starting a lot is what puts it in front of buyers — the
                    backend allows one open auction per show and re-validates
                    ownership, stock and price. */}
                {p.kind === 'auction' && tab === 'auction' && (
                  <Pressable
                    onPress={() => startLot(p)}
                    disabled={starting !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Start auction for ${p.title}`}
                    style={({ pressed }) => [
                      styles.startBtn,
                      starting !== null && { opacity: 0.5 },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    {starting === p.id ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.startText}>Start</Text>
                    )}
                  </Pressable>
                )}

                {/* Draw the giveaway winner — an on-air action (the server
                    announces in chat), so only while live and not yet drawn.
                    With a known count of 0 the button says so and stays put;
                    an UNKNOWN count (aggregate read failed) still allows the
                    tap — the server refuses an empty draw with its own
                    message. */}
                {p.kind === 'giveaway' && tab === 'giveaway' && !!isLive && !winnerName && (
                  <Pressable
                    onPress={() => confirmDraw(p)}
                    disabled={drawing !== null || entries === 0}
                    accessibilityRole="button"
                    accessibilityLabel={`Draw the winner for ${p.title}`}
                    accessibilityState={{ disabled: drawing !== null || entries === 0 }}
                    style={({ pressed }) => [
                      styles.startBtn,
                      (drawing !== null || entries === 0) && { opacity: 0.5 },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    {drawing === p.id ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.startText}>
                        {entries === 0 ? 'No entries' : 'Draw winner'}
                      </Text>
                    )}
                  </Pressable>
                )}
              </View>
              );
            })
          )}
        </ScrollView>

        {/* Tooltip only while there is genuinely nothing to show. */}
        {sorted.length === 0 && tab !== 'pending' && tab !== 'offers' && !loading && (
          <View style={[styles.tooltip, { bottom: insets.bottom + 92 }]}>
            <Text style={styles.tooltipTitle}>Add products</Text>
            <Text style={styles.tooltipBody}>Tap here to add your first product listing.</Text>
            <View style={styles.tooltipTail} />
          </View>
        )}

        <Pressable
          onPress={() => setCreateOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Add products"
          style={({ pressed }) => [styles.fab, { bottom: insets.bottom + Spacing.three }, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="add" size={30} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* ── Create menu ── */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCreateOpen(false)} accessibilityLabel="Close" />
        <View style={[styles.createSheet, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.grabber} />
          <Text style={styles.createTitle}>Create</Text>
          <CreateRow
            icon="pricetag-outline"
            title="Create Quality Listing"
            body="Create a listing with photos and details."
            onPress={() => {
              setCreateOpen(false);
              setForm('quality');
            }}
          />
          <CreateRow
            icon="flash-outline"
            title="Create Temporary Listing"
            body="Listings that will expire when show ends."
            onPress={() => {
              setCreateOpen(false);
              setForm('temporary');
            }}
          />
          <CreateRow
            icon="albums-outline"
            title="Attach from Catalogue"
            body="Add products you already own to this show."
            onPress={() => {
              setCreateOpen(false);
              setAttachOpen(true);
            }}
          />
        </View>
      </Modal>

      {/* ── Attach from catalogue ── */}
      <AttachSheet
        visible={attachOpen}
        showId={showId}
        onClose={() => setAttachOpen(false)}
        onChanged={load}
      />

      {/* ── Flash sale setup ── */}
      {flashFor && (
        <FlashSheet
          product={flashFor}
          onClose={() => setFlashFor(null)}
          onStarted={(productId, flash) => {
            setFlashFor(null);
            if (flash) setLocalFlash((prev) => ({ ...prev, [productId]: flash }));
            load();
          }}
        />
      )}

      {/* ── Sort ── */}
      <Modal visible={sortOpen} transparent animationType="slide" onRequestClose={() => setSortOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSortOpen(false)} accessibilityLabel="Close" />
        <View style={[styles.createSheet, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.grabber} />
          <Text style={styles.createTitle}>Sort</Text>
          {SORTS.map((s) => (
            <Pressable
              key={s.value}
              onPress={() => {
                setSort(s.value);
                setSortOpen(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: s.value === sort }}
              accessibilityLabel={s.label}
              style={({ pressed }) => [styles.sortRow, pressed && { opacity: 0.75 }]}
            >
              <Text style={styles.rowTitle}>{s.label}</Text>
              {s.value === sort && <Ionicons name="checkmark" size={20} color={TONE.primary} />}
            </Pressable>
          ))}
        </View>
      </Modal>

    </Modal>

    {/* A SIBLING of the sheet's Modal, never a child of it: a full-screen
        modal nested inside another modal gets laid out inside its parent's
        window on Android and ends up offset down the screen. */}
    {form !== null && (
      <CreateListing
        mode={form}
        showId={showId}
        uid={uid}
        recentCategory={recentCategory}
        onClose={() => setForm(null)}
        onCreated={() => {
          setForm(null);
          load();
        }}
      />
    )}
    </>
  );
}

/** Rupees typed by a human → integer paise. Null when unusable. */
function rupeesToPaise(rupees: string): number | null {
  const n = Number(rupees.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const paise = Math.round(n * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

/** The flash control on a Buy Now row. Its OWN component so the 1s countdown
 *  re-renders one chip, not the whole list — and so useFlashSale retires the
 *  chip at zero by itself. */
function FlashCell({
  flashSale,
  busy,
  onStart,
  onEndEarly,
}: {
  flashSale: { pricePaise: number; endsAt: unknown } | null;
  busy: boolean;
  onStart: () => void;
  /** Called with the running flash's price (the /flash body needs one). */
  onEndEarly: (pricePaise: number) => void;
}) {
  // Seller-side: the chip must show ANY running flash — even one the charge
  // path would refuse (e.g. the list price was edited to below the flash
  // price) — because tapping the chip is the only end-early control.
  // Infinity disables activeFlashSale's buyer-display price clamp while
  // keeping the integer/₹1-minimum/time checks.
  const flash = useFlashSale({ flashSale, price: Number.POSITIVE_INFINITY });
  if (flash) {
    return (
      <Pressable
        onPress={() => onEndEarly(flash.pricePaise)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Flash sale at ${formatPaise(flash.pricePaise)}, ${flashClock(
          flash.msLeft
        )} left. End early`}
        style={({ pressed }) => [
          styles.flashChipBtn,
          busy && { opacity: 0.5 },
          pressed && { opacity: 0.8 },
        ]}
      >
        {busy ? (
          <ActivityIndicator color="#FFD166" size="small" />
        ) : (
          <>
            <Ionicons name="flash" size={13} color="#FFD166" />
            <Text style={styles.flashChipText}>{flashClock(flash.msLeft)}</Text>
          </>
        )}
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onStart}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Start a flash sale"
      style={({ pressed }) => [
        styles.flashBtn,
        busy && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Ionicons name="flash-outline" size={18} color={TONE.text} />
    </Pressable>
  );
}

/** Flash-sale setup: a price under list + a 1–60 minute window
 *  (POST /api/products/:id/flash). The server re-validates both. */
function FlashSheet({
  product,
  onClose,
  onStarted,
}: {
  product: SellerProduct;
  onClose: () => void;
  /** The started flash as the server reported it (or a client echo of what
   *  it accepted, when the response omits it) — for immediate display. */
  onStarted: (productId: string, flash: { pricePaise: number; endsAt: string } | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const [price, setPrice] = useState('');
  const [minutes, setMinutes] = useState('10');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pricePaise = rupeesToPaise(price);
  const mins = Math.round(Number(minutes.replace(/[^0-9]/g, '')));
  const priceOk = pricePaise != null && pricePaise < product.price;
  const minsOk = Number.isFinite(mins) && mins >= FLASH_MINUTES_MIN && mins <= FLASH_MINUTES_MAX;

  async function start() {
    if (!priceOk || !minsOk || pricePaise == null || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await setFlashSale(product.id, pricePaise, mins);
      onStarted(
        product.id,
        r.flashSale ?? {
          pricePaise,
          // The server accepted `minutes` — echo the window it granted so the
          // chip can show at once even if the response body omits it.
          endsAt: new Date(serverNow() + mins * 60_000).toISOString(),
        }
      );
    } catch (e) {
      setErr(serverMessage(e, 'Couldn’t start the flash sale — please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.createSheet, { paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.grabber} />
        <Text style={styles.createTitle}>Flash sale</Text>
        <Text style={styles.rowMeta}>
          {product.title} · listed at {formatPaise(product.price)}. Buyers pay the flash
          price until the timer runs out.
        </Text>

        <FieldBox
          label="Flash price"
          required
          value={price}
          onChangeText={setPrice}
          placeholder={`Under ${formatPaise(product.price)}`}
          keyboardType="number-pad"
          prefix="₹"
          accessibilityLabel="Flash price in rupees"
        />
        {!!price.trim() && !priceOk && (
          <Text style={styles.flashError}>
            The flash price must be under the list price ({formatPaise(product.price)}).
          </Text>
        )}

        <FieldBox
          label="Minutes (1–60)"
          required
          value={minutes}
          onChangeText={setMinutes}
          placeholder="10"
          keyboardType="number-pad"
          accessibilityLabel="Flash sale length in minutes"
        />
        {!!minutes.trim() && !minsOk && (
          <Text style={styles.flashError}>Between 1 and 60 minutes.</Text>
        )}

        {!!err && <Text style={styles.flashError}>{err}</Text>}

        <Pressable
          onPress={start}
          disabled={!priceOk || !minsOk || busy}
          accessibilityRole="button"
          accessibilityLabel="Start flash sale"
          accessibilityState={{ disabled: !priceOk || !minsOk || busy }}
          style={({ pressed }) => [
            styles.flashStartBtn,
            (!priceOk || !minsOk || busy) && { opacity: 0.5 },
            pressed && { opacity: 0.85 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.startText}>
              {priceOk && pricePaise != null
                ? `Start · ${formatPaise(pricePaise)} for ${minsOk ? mins : '—'} min`
                : 'Start flash sale'}
            </Text>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

/** Empty state built on the real Any&All ribbon mark. */
function Empty({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Image
        source={require('../../assets/images/brand-mark.png')}
        style={styles.emptyMark}
        contentFit="contain"
        accessibilityIgnoresInvertColors
        accessible={false}
      />
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

/** Attach/detach the seller's existing catalogue to THIS show.
 *
 *  Attachment is what makes a product purchasable in the room —
 *  POST /api/products/:id/attach-show, and detach-show for the reverse
 *  (back to unattached inventory; never deletes). Only ACTIVE products are
 *  offered: the server refuses drafts and retired listings (409
 *  PRODUCT_NOT_ACTIVE), so listing them here would only manufacture a
 *  failure. Temporary listings belong to their own show and stay out too. */
function AttachSheet({
  visible,
  showId,
  onClose,
  onChanged,
}: {
  visible: boolean;
  showId: string;
  onClose: () => void;
  /** Fired after any attach/detach so the listings behind this sheet refresh. */
  onChanged: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<SellerProduct[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getMyProducts();
      setItems(r.products);
    } catch {
      setItems([]);
    }
  }, []);

  // Fresh read each open. The await defers the first setState out of the
  // effect body itself, which the compiler's purity rules require.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, load]);

  const all = items ?? [];
  const attached = all.filter((p) => p.showId === showId);
  const attachable = all.filter(
    (p) => p.showId !== showId && p.status === 'active' && !p.temporary
  );
  const hiddenCount = all.filter(
    (p) => p.showId !== showId && (p.status !== 'active' || p.temporary)
  ).length;

  async function attach(p: SellerProduct) {
    if (busy) return;
    setBusy(p.id);
    try {
      await attachProductToShow(p.id, { showId });
      await load();
      onChanged();
    } catch (err) {
      Alert.alert(
        'Couldn’t attach this product',
        serverMessage(err, 'Please try again.')
      );
    } finally {
      setBusy(null);
    }
  }

  async function detach(p: SellerProduct) {
    if (busy) return;
    setBusy(p.id);
    try {
      await detachProductFromShow(p.id);
      await load();
      onChanged();
    } catch (err) {
      Alert.alert(
        'Couldn’t remove this product',
        serverMessage(err, 'Please try again.')
      );
    } finally {
      setBusy(null);
    }
  }

  const row = (p: SellerProduct, inShow: boolean) => (
    <View key={p.id} style={styles.attachRow}>
      {p.thumbnail_url ? (
        <Image source={{ uri: p.thumbnail_url }} style={styles.rowThumb} contentFit="cover" />
      ) : (
        <View style={styles.rowThumbEmpty}>
          <Ionicons name="image-outline" size={20} color={TONE.faint} />
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {p.title}
        </Text>
        <Text style={styles.rowMeta}>
          {formatPaise(p.price)} · {Math.max(0, p.stock - p.sold)} available
        </Text>
      </View>
      <Pressable
        onPress={() => (inShow ? detach(p) : attach(p))}
        disabled={busy !== null}
        accessibilityRole="button"
        accessibilityLabel={
          inShow ? `Remove ${p.title} from this show` : `Attach ${p.title} to this show`
        }
        style={({ pressed }) => [
          inShow ? styles.detachBtn : styles.attachBtn,
          busy !== null && { opacity: 0.5 },
          pressed && { opacity: 0.8 },
        ]}
      >
        {busy === p.id ? (
          <ActivityIndicator color={inShow ? TONE.text : '#FFFFFF'} size="small" />
        ) : (
          <Text style={inShow ? styles.detachText : styles.attachText}>
            {inShow ? 'Remove' : 'Attach'}
          </Text>
        )}
      </Pressable>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.createSheet, { paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.grabber} />
        <Text style={styles.createTitle}>Attach from Catalogue</Text>

        {items === null ? (
          <ActivityIndicator color={TONE.primary} style={{ marginVertical: Spacing.four }} />
        ) : (
          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {attached.length > 0 && (
              <>
                <Text style={styles.attachSection}>In this show</Text>
                {attached.map((p) => row(p, true))}
              </>
            )}

            <Text style={styles.attachSection}>In your catalogue</Text>
            {attachable.length === 0 ? (
              <Text style={styles.rowMeta}>
                {all.length === 0
                  ? 'Your catalogue is empty. Create a listing first.'
                  : 'Everything attachable is already in this show.'}
              </Text>
            ) : (
              attachable.map((p) => row(p, false))
            )}

            {hiddenCount > 0 && (
              <Text style={styles.attachFootnote}>
                {hiddenCount} item{hiddenCount === 1 ? ' is' : 's are'} not shown — drafts,
                retired and temporary listings can’t be attached. Publish them from Inventory
                first.
              </Text>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function CreateRow({
  icon,
  title,
  body,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.createRow, pressed && { opacity: 0.75 }]}
    >
      <View style={styles.createIcon}>
        <Ionicons name={icon} size={22} color={TONE.text} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.createRowTitle}>{title}</Text>
        <Text style={styles.createRowBody}>{body}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...(StyleSheet.absoluteFill as object), backgroundColor: 'rgba(2,6,16,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 70,
    backgroundColor: TONE.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: TONE.border,
  },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    borderWidth: 1,
    borderColor: TONE.borderStrong,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    minHeight: 50,
  },
  searchInput: { flex: 1, color: TONE.text, fontSize: 15, fontFamily: Fonts.sans },

  tabsWrap: { flexGrow: 0, flexShrink: 0 },
  tabs: { gap: Spacing.three, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  tab: { paddingBottom: 10 },
  tabText: { color: TONE.faint, fontSize: 17, fontFamily: Fonts.sansSemiBold },
  tabTextOn: { color: TONE.text },
  tabUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: TONE.text,
  },

  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TONE.border,
  },
  filterBtn: {
    width: 46,
    height: 42,
    borderRadius: 10,
    backgroundColor: 'rgba(120,150,210,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  preBids: {
    height: 42,
    borderRadius: 10,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(120,150,210,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
  },
  preBidsText: { color: TONE.text, fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  count: { color: TONE.text, fontSize: 15.5, fontFamily: Fonts.sansSemiBold },

  list: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: 120, gap: Spacing.two },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: TONE.border,
    backgroundColor: TONE.surface,
    borderRadius: 12,
    padding: 10,
  },
  rowThumb: { width: 52, height: 52, borderRadius: 8 },
  rowThumbEmpty: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: 'rgba(20,36,70,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: TONE.text, fontSize: 15, fontFamily: Fonts.sansSemiBold },
  rowMeta: { color: TONE.dim, fontSize: 12.5, fontFamily: Fonts.sans },
  rowPrice: { color: TONE.text, fontSize: 15, fontFamily: Fonts.sansSemiBold },
  startBtn: {
    backgroundColor: TONE.primary,
    borderRadius: 999,
    paddingHorizontal: 16,
    minHeight: 38,
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startText: { color: '#FFFFFF', fontSize: 14, fontFamily: Fonts.sansSemiBold },
  pinBtn: {
    width: 40,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: TONE.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBtnOn: { backgroundColor: TONE.primary, borderColor: TONE.primary },

  // ── Offers ────────────────────────────────────────────────────────────
  declineBtn: {
    borderWidth: 1,
    borderColor: TONE.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 38,
    minWidth: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: { color: TONE.text, fontSize: 13.5, fontFamily: Fonts.sansSemiBold },

  // ── Flash sales ───────────────────────────────────────────────────────
  flashBtn: {
    width: 40,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: TONE.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashChipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,209,102,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,209,102,0.45)',
    paddingHorizontal: 10,
    minHeight: 38,
    minWidth: 64,
    justifyContent: 'center',
  },
  flashChipText: { color: '#FFD166', fontSize: 13, fontFamily: Fonts.sansSemiBold },
  flashError: { color: '#FF8B8B', fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17 },
  flashStartBtn: {
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: TONE.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
  },

  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 64,
  },
  attachSection: {
    color: TONE.faint,
    fontSize: 12,
    fontFamily: Fonts.sansSemiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  attachBtn: {
    backgroundColor: TONE.primary,
    borderRadius: 999,
    paddingHorizontal: 16,
    minHeight: 38,
    minWidth: 78,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachText: { color: '#FFFFFF', fontSize: 14, fontFamily: Fonts.sansSemiBold },
  detachBtn: {
    borderWidth: 1,
    borderColor: TONE.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 16,
    minHeight: 38,
    minWidth: 78,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detachText: { color: TONE.text, fontSize: 14, fontFamily: Fonts.sansSemiBold },
  attachFootnote: {
    color: TONE.faint,
    fontSize: 11.5,
    fontFamily: Fonts.sans,
    lineHeight: 16,
    paddingTop: Spacing.two,
  },

  empty: { alignItems: 'center', gap: Spacing.three, paddingTop: 70 },
  emptyMark: { width: 132, height: 132, opacity: 0.22 },
  emptyText: {
    color: TONE.dim,
    fontSize: 20,
    fontFamily: Fonts.sansSemiBold,
    textAlign: 'center',
    lineHeight: 27,
  },

  tooltip: {
    position: 'absolute',
    right: Spacing.three,
    maxWidth: 250,
    backgroundColor: '#E9EEF6',
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    paddingVertical: 12,
    gap: 3,
  },
  tooltipTitle: { color: '#0B1B3A', fontSize: 15, fontFamily: Fonts.sansSemiBold },
  tooltipBody: { color: '#33425F', fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 18 },
  tooltipTail: {
    position: 'absolute',
    right: 18,
    bottom: -7,
    width: 14,
    height: 14,
    backgroundColor: '#E9EEF6',
    transform: [{ rotate: '45deg' }],
  },

  fab: {
    position: 'absolute',
    right: Spacing.three,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: TONE.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  createSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0C1730',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: TONE.border,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,150,210,0.35)',
    alignSelf: 'center',
    marginBottom: Spacing.two,
  },
  createTitle: {
    color: TONE.text,
    fontSize: 19,
    fontFamily: Fonts.sansSemiBold,
    textAlign: 'center',
    marginBottom: Spacing.one,
  },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 68 },
  createIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(120,150,210,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRowTitle: { color: TONE.text, fontSize: 16.5, fontFamily: Fonts.sansSemiBold },
  createRowBody: { color: TONE.dim, fontSize: 13.5, fontFamily: Fonts.sans },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 54 },
});
