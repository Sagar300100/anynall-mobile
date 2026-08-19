// Show Room — the seller's pre-live studio for a scheduled show.
//
// Reached from Seller Hub → Upcoming Shows → tap a show.
//
// WHAT IS REAL HERE: the store identity, the countdown (ticks every second
// off the show's real scheduled_time), Share (native sheet, real deep link),
// Show Notes (persisted on the show doc, seller-only), Shop (the Live
// Listings panel — products genuinely attached to this show, plus the two
// create paths), and chat (the shows/{id}/chat subcollection that
// firestore.rules already defines).
//
// WHAT IS NOT, AND WHY IT IS NOT FAKED:
//   • Camera preview — expo-camera isn't installed, and neither is a LiveKit
//     client SDK, so the canvas stays a dark surface rather than a stock
//     photo. The reference's centre area is empty video; that is what renders.
//   • Add to Calendar — expo-calendar isn't installed, so the button says so
//     instead of silently doing nothing.
//   • Viewer count — there is no presence system in this backend, so it shows
//     "—" rather than an invented number.
//   • Promote — no promotion system exists.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BroadcastStage } from '@/components/broadcast-stage';
import { LiveListings } from '@/components/live-listings';
import { AgentHelperSheet } from '@/components/agent-helper-sheet';
import { ShowMoreSheet } from '@/components/show-more-sheet';
import { Fonts, Spacing } from '@/constants/theme';
import { useScreenFocused } from '@/hooks/use-screen-focused';
import { formatPaise, type AuctionRecord } from '@/lib/commerce';
import { auth, db } from '@/lib/firebase';
import { subscribe as engineSubscribe, type EngineAuction } from '@/lib/auction-socket';
import { listenAuctions, listenProducts, type ProductDoc } from '@/lib/realtime';
import { getSellerOnboarding, type SellerOnboardingState } from '@/lib/seller';
import { getMyProducts } from '@/lib/seller-hub';
import { msUntil } from '@/lib/server-time';
import { backfillSellerIdentity } from '@/lib/shows';
import { endStream, getStreamToken, streamErrorMessage } from '@/lib/stream';

/** Public show link. Same URL the share sheet and any deep link would use. */
const showUrl = (id: string) => `https://anynall.com/show/${id}`;

/** Module scope on purpose — see the note where BroadcastStage is rendered. */
function reportBroadcastError(message: string) {
  Alert.alert('Broadcast', message);
}

interface ChatEvent {
  id: string;
  uid: string;
  name: string;
  text: string;
}

/** "45m 12s", "2h 18m", "57s". Null once the start time has passed, so the
 *  screen stops counting rather than going negative. */
function countdownLabel(msLeft: number): string | null {
  if (msLeft <= 0) return null;
  const s = Math.floor(msLeft / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function ShowRoomScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const showId = String(id ?? '');

  const [title, setTitle] = useState('');
  const [startsAtMs, setStartsAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [seller, setSeller] = useState<SellerOnboardingState | null>(null);
  const [chat, setChat] = useState<ChatEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** Badge on the Shop rail button — the real number of listings attached to
   *  this show, or null until it has actually been read. */
  const [shopCount, setShopCount] = useState<number | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [helperOpen, setHelperOpen] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  // The lot on the block. The seller was running a live auction with no idea
  // what was on screen or who was ahead — they had to open Shop to find out.
  const [auctions, setAuctions] = useState<AuctionRecord[]>([]);
  const [products, setProducts] = useState<ProductDoc[]>([]);
  // Tab screens stay mounted, so the camera must only run while this screen is
  // actually on top — otherwise it keeps publishing from behind another route.
  const screenFocused = useScreenFocused(true);

  const [sheet, setSheet] = useState<'notes' | null>(null);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // ── Show + seller ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [snap, s] = await Promise.allSettled([
        getDoc(doc(db, 'shows', showId)),
        getSellerOnboarding(),
      ]);
      if (cancelled) return;
      if (snap.status === 'fulfilled' && snap.value.exists()) {
        const d = snap.value.data();
        setTitle(String(d.title ?? 'Untitled show'));
        setNotes(String(d.sellerNotes ?? ''));
        setIsLive(d.isLive === true);
        const t = d.scheduled_time ? new Date(String(d.scheduled_time)).getTime() : NaN;
        setStartsAtMs(Number.isNaN(t) ? null : t);
      }
      if (s.status === 'fulfilled') {
        setSeller(s.value);
        // Heal older shows that predate the seller-identity stamp, so buyers
        // stop seeing them unnamed. Owner-only, silent, one-time per show.
        backfillSellerIdentity(showId, s.value.storeName, s.value.storeHandle);
      }
      setNowMs(Date.now());
    })();
    return () => {
      cancelled = true;
    };
  }, [showId]);

  // ── One-second tick. The clock lives in state so nothing reads Date.now()
  //    during render (React Compiler purity). ──
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── The live lot: same Firestore streams the buyer's room watches, so both
  //    sides see a bid at the same moment. ──
  useEffect(() => {
    if (!showId) return;
    const offAuctions = listenAuctions(showId, setAuctions);
    const offProducts = listenProducts(showId, setProducts);
    return () => {
      offAuctions();
      offProducts();
    };
  }, [showId]);

  // ── The seller's fast lane ──
  //
  // The buyer's room already listens here; the seller's did not, so a bid the
  // bidder saw in ~30ms reached the SELLER only after write-behind plus a
  // Firestore fan-out — about a second. The person running the auction was the
  // last to know a bid had landed, which is the wrong way round.
  //
  // Merged by VERSION, like the buyer's room: whichever of engine or Firestore
  // arrives first wins and the other is a no-op, so they can never fight.
  useEffect(() => {
    if (!showId) return;
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

    return engineSubscribe(showId, {
      onState: (list) => list.forEach(mergeOne),
      onBid: mergeOne,
      onError: () => {
        /* display-only here: the seller does not bid, and the Firestore
           listener above remains the source of truth. */
      },
    });
  }, [showId]);

  // ── Live chat: the shows/{id}/chat subcollection in firestore.rules ──
  useEffect(() => {
    if (!showId) return;
    const q = query(
      collection(db, 'shows', showId, 'chat'),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    return onSnapshot(
      q,
      (snap) => {
        setChat(
          snap.docs
            .map((d) => {
              const v = d.data();
              return {
                id: d.id,
                uid: String(v.uid ?? ''),
                name: String(v.name ?? 'Someone'),
                text: String(v.text ?? ''),
              };
            })
            .reverse()
        );
      },
      () => setChat([])
    );
  }, [showId]);

  const loadShopCount = useCallback(async () => {
    try {
      const r = await getMyProducts();
      setShopCount(r.products.filter((p) => p.showId === showId).length);
    } catch {
      setShopCount(null);
    }
  }, [showId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) await loadShopCount();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadShopCount]);

  const msLeft = startsAtMs !== null && nowMs ? startsAtMs - nowMs : null;
  const countdown = msLeft === null ? null : countdownLabel(msLeft);

  // Newest auction drives the strip; only an OPEN one is on the block.
  const lot = auctions[0] && auctions[0].status === 'open' ? auctions[0] : null;
  const lotProduct = lot ? products.find((p) => p.id === lot.productId) || null : null;
  // `nowMs` already ticks once a second for the show countdown; reading it
  // here is what re-runs this line, so the lot clock needs no second interval.
  // msUntil() measures against the SERVER clock, like the buyer's panel.
  const lotMsLeft = lot && nowMs ? msUntil(lot.endsAt) : 0;
  const lotSeconds = Math.max(0, Math.ceil(lotMsLeft / 1000));
  const lotClock = `${String(Math.floor(lotSeconds / 60)).padStart(2, '0')}:${String(
    lotSeconds % 60
  ).padStart(2, '0')}`;
  const startsAtLabel =
    startsAtMs === null
      ? null
      : new Date(startsAtMs).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });

  async function share() {
    try {
      await Share.share({
        message: `${title} on Any&All — ${showUrl(showId)}`,
        url: showUrl(showId),
        title,
      });
    } catch {
      /* the user dismissed the sheet */
    }
  }

  async function sendChat() {
    const text = draft.trim();
    const uid = auth.currentUser?.uid;
    if (!text || !uid || sending) return;
    setSending(true);
    setDraft('');
    try {
      await addDoc(collection(db, 'shows', showId, 'chat'), {
        uid,
        name: seller?.storeName || 'Seller',
        text: text.slice(0, 300),
        createdAt: new Date().toISOString(),
      });
    } catch {
      setDraft(text); // keep what they typed
      Alert.alert('Message not sent', 'Please check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  // Going live is SERVER-owned. Requesting a host token is what opens the
  // room: streamRouter sets liveRooms/{id}.live and stamps shows.isLive in the
  // same call. Writing isLive from the client (as this used to) marked the
  // show live in the browse rails while every viewer's token request was still
  // refused with SHOW_NOT_LIVE, because the liveRooms gate never existed.
  async function toggleLive() {
    if (goingLive) return;
    const next = !isLive;
    setGoingLive(true);
    try {
      if (next) {
        await getStreamToken(showId, 'host', seller?.storeName || undefined);
      } else {
        await endStream(showId);
      }
      setIsLive(next);
    } catch (err) {
      Alert.alert(next ? 'Couldn’t go live' : 'Couldn’t end the show', streamErrorMessage(err));
    } finally {
      setGoingLive(false);
    }
  }

  async function saveNotes() {
    setSavingNotes(true);
    try {
      // Seller-only field on the show doc; rules restrict update to the owner.
      await updateDoc(doc(db, 'shows', showId), { sellerNotes: notes });
      setSheet(null);
    } catch {
      Alert.alert('Couldn’t save notes', 'Please try again.');
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: '#050B18' }]}>
      {/* The video canvas fills the screen; everything else overlays it. */}
      <View style={styles.canvas}>
        {isLive && screenFocused ? (
          // Live: the seller's own camera, published to the LiveKit room.
          // Props MUST stay referentially stable. This screen re-renders every
          // second (the countdown tick), and an inline arrow for onError made
          // BroadcastStage re-render each time, which tore down and re-created
          // the LiveKit room — it logged "already connected" once a second and
          // never finished publishing the camera.
          <BroadcastStage
            showId={showId}
            displayName={seller?.storeName || undefined}
            onError={reportBroadcastError}
          />
        ) : (
          <>
            {/* The real Any&All ribbon mark, dimmed to a watermark. Using the
                actual brand asset rather than redrawing an approximation. */}
            <Image
              source={require('../../../../assets/images/brand-mark.png')}
              style={styles.watermark}
              contentFit="contain"
              accessibilityIgnoresInvertColors
              accessible={false}
            />
            <Text style={styles.canvasNote}>Your camera starts when you go live</Text>
          </>
        )}
      </View>

      <SafeAreaView style={styles.overlay} edges={['top']}>
        {/* ── Seller header ── */}
        <View style={styles.header}>
          {seller?.storePhotoUrl ? (
            <Image source={{ uri: seller.storePhotoUrl }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarEmpty]}>
              <Ionicons name="storefront-outline" size={20} color="#7FB2FF" />
            </View>
          )}
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={styles.storeName} numberOfLines={1}>
              {seller?.storeName || 'Your store'}
            </Text>
            {!!seller?.storeHandle && (
              <Text style={styles.storeHandle} numberOfLines={1}>
                @{seller.storeHandle}
              </Text>
            )}
          </View>
          {/* No presence system exists, so this is "—", never a fake number. */}
          <View style={styles.viewers} accessibilityLabel="Viewers: not available">
            <Ionicons name="stats-chart" size={14} color="#4A8FE5" />
            <Text style={styles.viewersText}>—</Text>
          </View>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/sell'))}
            accessibilityRole="button"
            accessibilityLabel="Close show room"
            hitSlop={8}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="chevron-down" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* ── Pre-live card / live bar ──
            Once the show is LIVE this collapses to a single strip. The full
            card — big countdown, Share, Add to Calendar — was eating roughly
            half the screen ON TOP OF THE SELLER'S OWN CAMERA, and every one of
            those actions is a pre-show concern: nobody adds a calendar entry
            for a show that has already started. Share stays reachable on the
            right rail. */}
        {isLive ? (
          <View style={styles.liveBar}>
            <View style={styles.liveDot} />
            <Text style={styles.liveBarText}>LIVE</Text>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={toggleLive}
              disabled={goingLive}
              accessibilityRole="button"
              accessibilityLabel="End show"
              style={({ pressed }) => [
                styles.endBtn,
                goingLive && { opacity: 0.6 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="stop-circle-outline" size={16} color="#FFFFFF" />
              <Text style={styles.endBtnText}>{goingLive ? 'Working…' : 'End Show'}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.countdownCard}>
            <Text style={styles.startsAt}>
              {startsAtLabel ? `Show starts at ${startsAtLabel}` : 'Start time unavailable'}
            </Text>
            <Text style={styles.countdown}>{countdown ?? 'Starting now'}</Text>
            {/* Go Live opens the room to buyers: it sets isLive, which is what
                the Live tab's grid and the show page's Join button gate on. */}
            <Pressable
              onPress={toggleLive}
              disabled={goingLive}
              accessibilityRole="button"
              accessibilityLabel="Go live"
              style={({ pressed }) => [
                styles.primaryBtn,
                goingLive && { opacity: 0.6 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="radio-outline" size={19} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>{goingLive ? 'Working…' : 'Go Live'}</Text>
            </Pressable>

            <Pressable
              onPress={share}
              accessibilityRole="button"
              accessibilityLabel="Share show"
              style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.75 }]}
            >
              <Ionicons name="share-outline" size={18} color="#4A8FE5" />
              <Text style={styles.secondaryBtnText}>Share Show</Text>
            </Pressable>
            {/* Contextual AI — the live-show helper agent (same one the web's
                floating assistant switches to in the studio). */}
            <Pressable
              onPress={() => setHelperOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Show helper — AI tips for running this show"
              style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.75 }]}
            >
              <Ionicons name="sparkles-outline" size={17} color="#4A8FE5" />
              <Text style={styles.secondaryBtnText}>Show Helper</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert(
                  'Add to Calendar',
                  'Calendar support needs the expo-calendar package, which isn’t installed yet.'
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Add to calendar"
              style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.75 }]}
            >
              <Ionicons name="calendar-outline" size={18} color="#4A8FE5" />
              <Text style={styles.secondaryBtnText}>Add to Calendar</Text>
            </Pressable>
          </View>
        )}

        {/* ── Show Notes (Any&All navy, not the reference's yellow sticky) ── */}
        <Pressable
          onPress={() => setSheet('notes')}
          accessibilityRole="button"
          accessibilityLabel="Show notes"
          style={({ pressed }) => [styles.notesChip, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="document-text-outline" size={16} color="#7FB2FF" />
          <Text style={styles.notesChipText}>Show{'\n'}Notes</Text>
        </Pressable>

        {/* ── Right rail, floating over the canvas ── */}
        <View style={styles.rail}>
          <RailButton icon="ellipsis-horizontal" label="More" onPress={() => setMoreOpen(true)} />
          <RailButton
            icon="trending-up"
            label="Promote"
            dimmed
            onPress={() =>
              Alert.alert('Promote', 'Promotion isn’t built yet, so there’s nothing to run here.')
            }
          />
          <RailButton icon="share-outline" label="Share" onPress={share} />
          <RailButton
            icon="storefront-outline"
            label="Shop"
            badge={shopCount ?? undefined}
            onPress={() => setShopOpen(true)}
          />
        </View>

        {/* ── Chat activity + input ── */}
        <KeyboardAvoidingView
          style={styles.bottom}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.chatFeed}>
            {chat.slice(-4).map((m) => (
              <View key={m.id} style={styles.chatRow}>
                <View style={styles.chatAvatar}>
                  <Text style={styles.chatAvatarText}>{(m.name[0] || '?').toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.chatName}>{m.name}</Text>
                  <Text style={styles.chatText}>{m.text}</Text>
                </View>
              </View>
            ))}
          </View>
          {/* ── The lot on the block ──
              Everything here is read straight off the auction doc the buyers
              bid into, so the seller sees the price and the leader at the same
              instant a bidder does. Nothing is displayed that isn't in the
              doc: with no bids yet it says so rather than inventing a name. */}
          {!!lot && (
            <View style={styles.lotStrip}>
              {!!lotProduct?.thumbnail_url && (
                <Image
                  source={{ uri: lotProduct.thumbnail_url }}
                  style={styles.lotThumb}
                  contentFit="cover"
                />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.lotTitle} numberOfLines={1}>
                  {lotProduct?.title || 'Live lot'}
                </Text>
                <Text style={styles.lotWho} numberOfLines={1}>
                  {(lot.bidCount || 0) > 0 && lot.currentBidderName ? (
                    <>
                      <Text style={styles.lotWhoName}>{lot.currentBidderName}</Text> is winning
                      {` · ${lot.bidCount} bid${lot.bidCount === 1 ? '' : 's'}`}
                    </>
                  ) : (
                    'No bids yet'
                  )}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={styles.lotPrice}>
                  {formatPaise((lot.bidCount || 0) > 0 ? lot.currentBid : lot.startPrice)}
                </Text>
                <Text style={[styles.lotClock, lotSeconds <= 15 && styles.lotClockHot]}>
                  {lot.suddenDeath === true ? '💀 ' : ''}
                  {lotClock}
                </Text>
              </View>
            </View>
          )}

          <View style={[styles.inputRow, { marginBottom: insets.bottom + Spacing.two }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Say something..."
              placeholderTextColor="rgba(159,180,216,0.6)"
              style={styles.input}
              accessibilityLabel="Chat message"
              onSubmitEditing={sendChat}
              returnKeyType="send"
            />
            <Pressable
              onPress={sendChat}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              hitSlop={8}
              style={({ pressed }) => [
                styles.sendBtn,
                (!draft.trim() || sending) && { opacity: 0.4 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="send" size={20} color="#2E6BFF" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ── Sheets ── */}
      <Modal
        visible={sheet !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSheet(null)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.grabber} />

          {sheet === 'notes' && (
            <>
              <Text style={styles.sheetTitle}>Show Notes</Text>
              <Text style={styles.sheetBody}>Only you can see these.</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Run of show, prices to remember, talking points…"
                placeholderTextColor="rgba(159,180,216,0.6)"
                style={styles.notesInput}
                accessibilityLabel="Show notes"
              />
              <Pressable
                onPress={saveNotes}
                disabled={savingNotes}
                accessibilityRole="button"
                accessibilityLabel="Save notes"
                style={({ pressed }) => [
                  styles.primaryBtn,
                  savingNotes && { opacity: 0.5 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.primaryBtnText}>{savingNotes ? 'Saving…' : 'Save notes'}</Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>

      {/* ── More → show controls ── */}
      <AgentHelperSheet
        visible={helperOpen}
        onClose={() => setHelperOpen(false)}
        agentId="live-show"
        title="Show helper"
        intro="I help you run a better live show — openers, pacing, auction timing, chat prompts, and what to do when the room goes quiet. What are you selling today?"
        placeholder="Ask about running your show…"
      />
      <ShowMoreSheet
        visible={moreOpen}
        showId={showId}
        onClose={() => setMoreOpen(false)}
        onCloned={loadShopCount}
      />

      {/* ── Shop → Live Listings ── */}
      <LiveListings
        visible={shopOpen}
        showId={showId}
        uid={auth.currentUser?.uid ?? null}
        onClose={() => setShopOpen(false)}
        onCountChange={setShopCount}
      />
    </View>
  );
}

function RailButton({
  icon,
  label,
  onPress,
  badge,
  dimmed,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  badge?: number;
  dimmed?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.railItem, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.railCircle, dimmed && { opacity: 0.5 }]}>
        <Ionicons name={icon} size={19} color="#FFFFFF" />
        {!!badge && badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.railLabel, dimmed && { opacity: 0.6 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  canvas: { ...StyleSheet.absoluteFill as object, alignItems: 'center', justifyContent: 'center', gap: 10 },
  watermark: { width: 210, height: 210, opacity: 0.09 },
  canvasNote: { color: 'rgba(159,180,216,0.35)', fontSize: 12, fontFamily: Fonts.sans },
  overlay: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarEmpty: {
    backgroundColor: 'rgba(46,107,255,0.18)',
    borderWidth: 2,
    borderColor: '#2E6BFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeName: { color: '#FFFFFF', fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  storeHandle: { color: 'rgba(159,180,216,0.85)', fontSize: 12, fontFamily: Fonts.sans },
  viewers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(74,143,229,0.35)',
    paddingHorizontal: 12,
    height: 36,
  },
  viewersText: { color: '#FFFFFF', fontSize: 14, fontFamily: Fonts.sansSemiBold },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(20,36,70,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Live: one strip instead of the pre-show card.
  liveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    height: 46,
    borderRadius: 999,
    backgroundColor: 'rgba(8,16,34,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(74,143,229,0.3)',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5484D' },
  liveBarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: Fonts.sansSemiBold,
    letterSpacing: 1,
  },
  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E5484D',
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 32,
  },
  endBtnText: { color: '#FFFFFF', fontSize: 13, fontFamily: Fonts.sansSemiBold },

  // The lot on the block, above the composer.
  lotStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.two,
    borderRadius: 14,
    backgroundColor: 'rgba(8,16,34,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(74,143,229,0.3)',
  },
  lotThumb: { width: 44, height: 44, borderRadius: 8 },
  lotTitle: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.sansSemiBold },
  lotWho: { color: 'rgba(159,180,216,0.9)', fontSize: 12.5, fontFamily: Fonts.sans },
  lotWhoName: { color: '#4DB8FF', fontFamily: Fonts.sansSemiBold },
  lotPrice: { color: '#FFFFFF', fontSize: 18, fontFamily: Fonts.sansSemiBold },
  lotClock: { color: 'rgba(159,180,216,0.9)', fontSize: 13, fontFamily: Fonts.mono },
  lotClockHot: { color: '#FF6B6B' },

  countdownCard: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    borderWidth: 1,
    borderColor: 'rgba(74,143,229,0.35)',
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  startsAt: {
    color: 'rgba(159,180,216,0.9)',
    fontSize: 13,
    fontFamily: Fonts.sans,
    textAlign: 'center',
  },
  countdown: {
    color: '#FFFFFF',
    fontSize: 38,
    fontFamily: Fonts.sansSemiBold,
    textAlign: 'center',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2E6BFF',
    borderRadius: 12,
    minHeight: 52,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(74,143,229,0.45)',
    borderRadius: 12,
    minHeight: 52,
  },
  secondaryBtnText: { color: '#4A8FE5', fontSize: 15.5, fontFamily: Fonts.sansSemiBold },

  notesChip: {
    marginTop: Spacing.two,
    marginLeft: Spacing.three,
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(20,36,70,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(74,143,229,0.35)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  notesChipText: {
    color: '#7FB2FF',
    fontSize: 11,
    fontFamily: Fonts.sansSemiBold,
    textAlign: 'center',
    lineHeight: 14,
  },

  rail: { position: 'absolute', right: Spacing.three, top: '44%', gap: Spacing.two + Spacing.one },
  railItem: { alignItems: 'center', gap: 5 },
  railCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(20,36,70,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  railLabel: { color: '#FFFFFF', fontSize: 11, fontFamily: Fonts.sansMedium },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2E6BFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: Fonts.sansSemiBold },

  bottom: { flex: 1, justifyContent: 'flex-end' },
  chatFeed: { paddingHorizontal: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  chatRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  chatAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2E6BFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatAvatarText: { color: '#FFFFFF', fontSize: 14, fontFamily: Fonts.sansSemiBold },
  chatName: { color: 'rgba(159,180,216,0.9)', fontSize: 13, fontFamily: Fonts.sans },
  chatText: { color: '#FFFFFF', fontSize: 14, fontFamily: Fonts.sansSemiBold },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14.5,
    fontFamily: Fonts.sans,
    borderWidth: 1,
    borderColor: 'rgba(74,143,229,0.3)',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
  },
  sendBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  backdrop: { ...StyleSheet.absoluteFill as object, backgroundColor: 'rgba(2,6,16,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0C1730',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: 'rgba(74,143,229,0.28)',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,150,210,0.35)',
    alignSelf: 'center',
    marginBottom: Spacing.one,
  },
  sheetTitle: { color: '#FFFFFF', fontSize: 17, fontFamily: Fonts.sansSemiBold },
  sheetBody: { color: 'rgba(159,180,216,0.9)', fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 52 },
  sheetRowText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.sans },
  notesInput: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: Fonts.sans,
    borderWidth: 1,
    borderColor: 'rgba(74,143,229,0.3)',
    borderRadius: 12,
    padding: Spacing.two,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 48,
  },
  productTitle: { flex: 1, color: '#FFFFFF', fontSize: 14, fontFamily: Fonts.sans },
  productPrice: { color: '#FFFFFF', fontSize: 14, fontFamily: Fonts.sansSemiBold },
});
