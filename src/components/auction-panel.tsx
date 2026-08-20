// Live auction — the buyer's lot card and bid bar at the foot of the room.
//
// State streams from the Firestore auction doc (listenAuctions); every write
// goes through the HTTP API. The countdown is display-only: when it hits zero
// any participant calls /finalize and the backend transaction decides.
//
// Money is ₹ paise throughout, and the primary action is Any&All cobalt — the
// reference this layout follows uses yellow, which is not our accent.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { isReady as engineReady, placeBid as enginePlaceBid } from '@/lib/auction-socket';
import {
  finalizeAuction,
  formatPaise,
  minNextBid,
  newIdempotencyKey,
  placeBid,
  type AuctionRecord,
} from '@/lib/commerce';
import type { ProductDoc } from '@/lib/realtime';
import { msUntil } from '@/lib/server-time';

interface Props {
  auction: AuctionRecord;
  product?: ProductDoc | null;
  myUid?: string | null;
  /** Set when the server says this buyer can't purchase from this seller.
   *  Bidding is disabled and the reason shown, rather than failing after they
   *  commit. The full sentence goes in the notice; `blockedLabel` is the short
   *  wording for the pill and the button. */
  blockedReason?: string | null;
  blockedLabel?: string | null;
  /** Gate: resolves true when the buyer may bid (profile ready), false when
   *  setup UI was opened instead — the panel then skips the bid call. */
  ensureReady: () => Promise<boolean>;
  onError: (message: string) => void;
}

const TONE = {
  surface: 'rgba(10,20,40,0.92)',
  border: 'rgba(74,143,229,0.28)',
  text: '#FFFFFF',
  dim: 'rgba(159,180,216,0.9)',
  faint: 'rgba(159,180,216,0.6)',
  primary: '#2E6BFF',
  live: '#FF6B6B',
} as const;

/** The panel sits directly on the video, so its text carries its own contrast
 *  rather than relying on a surface behind it. */
const SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.85)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
} as const;

const CONDITION_LABEL: Record<string, string> = {
  new: 'Brand New',
  'pre-owned': 'Pre-owned',
  mint: 'Mint',
  'near-mint': 'Near Mint',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

/** "00:07" — the reference's mm:ss, so a long lot reads correctly too. */
function clock(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Counts down against the SERVER's clock, not the device's.
 *
 *  `endsAt` is set by the server, so measuring it with a device clock that is
 *  a few seconds off showed every bidder a different number — and on a Sudden
 *  Death lot, where the last second decides the winner, a wrong countdown is
 *  the difference between bidding and not bothering. msUntil() applies the
 *  measured client/server offset. The server still re-checks every bid in a
 *  transaction, so this makes the DISPLAY honest; it was never a way in. */
function useCountdown(endsAt?: string | null) {
  const [msLeft, setMsLeft] = useState(() => msUntil(endsAt));
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setMsLeft(msUntil(endsAt));
    tick();
    const idInterval = setInterval(tick, 250);
    return () => clearInterval(idInterval);
  }, [endsAt]);
  return msLeft;
}

/** Rupees typed by a human → integer paise. Null when unusable. */
function toPaise(rupees: string): number | null {
  const n = Number(rupees.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const paise = Math.round(n * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

export function AuctionPanel({
  auction,
  product,
  myUid,
  blockedReason,
  blockedLabel,
  ensureReady,
  onError,
}: Props) {
  const blockedShort = blockedLabel || 'Buying unavailable';
  const msLeft = useCountdown(auction.endsAt);
  const [bidding, setBidding] = useState(false);
  /** Amount this device has just bid, shown before the server confirms. */
  const [pending, setPending] = useState<number | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    },
    []
  );
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');

  const open = auction.status === 'open';
  const secondsLeft = Math.ceil(msLeft / 1000);

  // Optimistic bid. Even a warm server round trip is ~1s, and a live auction
  // that doesn't react for a full second reads as broken — so the panel paints
  // the bid the instant it is tapped and lets the Firestore listener confirm
  // it. `pending` only ever applies while it is AHEAD of the doc, so once the
  // real value lands it stops mattering on its own; a rejected bid clears it
  // and the error is surfaced. The server remains the only authority.
  const pendingAhead = pending !== null && pending > (auction.currentBid || 0) ? pending : null;
  const shownBid = pendingAhead ?? auction.currentBid;
  const amInLead = pendingAhead !== null || (!!myUid && auction.currentBidderUid === myUid);
  const nextBid =
    pendingAhead !== null ? pendingAhead + (auction.bidStep || 100) : minNextBid(auction);

  // Ask for finalisation when the clock hits zero — and KEEP asking every 2s
  // until the status actually flips. This used to fire once per auction
  // version, so a single failed or lost /finalize left the winner waiting on
  // the backend's 60s sweep. finalizeAuction is idempotent server-side; the
  // busy flag keeps it to one call in flight, never the display tick's rate.
  // An anti-snipe extension flips `dueToFinalize` back off and clears the
  // interval, as does settlement, an auction change, or unmount.
  const dueToFinalize = open && msLeft <= 0;
  useEffect(() => {
    if (!dueToFinalize) return;
    let busy = false;
    const fire = () => {
      if (busy) return;
      busy = true;
      finalizeAuction(auction.id)
        .catch(() => {
          // AUCTION_STILL_LIVE / races are normal — Firestore will push the truth.
        })
        .finally(() => {
          busy = false;
        });
    };
    fire();
    const idInterval = setInterval(fire, 2000);
    return () => clearInterval(idInterval);
  }, [dueToFinalize, auction.id]);

  async function bid(amountPaise: number) {
    if (bidding) return;
    setBidding(true);
    try {
      // Paint FIRST, check readiness second. ensureReady() can cost a profile
      // round trip, and awaiting it before the paint made the very first bid —
      // the one that most needs to feel instant — the only slow one. If the
      // check fails, the paint rolls back and the setup sheet opens, which is
      // the same outcome in a different order.
      setPending(amountPaise);

      // Self-correcting safety net. If the bid was accepted the doc has caught
      // up well before this fires and clearing is a no-op. If it was REJECTED
      // over the socket — where there is no promise to reject — the optimistic
      // price disappears instead of sitting on screen as a number nobody
      // actually bid.
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => setPending(null), 3000);

      const ready = await ensureReady();
      if (!ready) {
        setPending(null); // the bid did not happen — take the paint back
        return;
      }

      // Socket first, HTTP second. enginePlaceBid() returns false whenever the
      // engine isn't connected — not deployed, unreachable, still connecting —
      // and the bid then takes exactly the path it always did. A buyer must
      // never be unable to bid because an accelerator is unhealthy.
      const key = newIdempotencyKey();
      if (!(engineReady() && enginePlaceBid(auction.id, amountPaise, key))) {
        await placeBid(auction.id, amountPaise, key);
      }
    } catch (err: unknown) {
      setPending(null); // roll the optimistic bid back — it did not happen
      const text = err instanceof Error ? err.message : String(err);
      // Friendly messages come through in the response body (HTTP 409 ...).
      const m = text.match(/"message"\s*:\s*"([^"]+)"/);
      onError(m?.[1] || 'Your bid didn’t go through — try again.');
    } finally {
      setBidding(false);
    }
  }

  if (!open && auction.status !== 'awaiting_winner_payment') return null;

  // When the optimistic bid is the one in front, the leader is this device.
  // Otherwise it's whoever the doc names — never a placeholder standing in for
  // a real bidder.
  const leaderName = amInLead ? 'You' : auction.currentBidderName || 'Someone';
  const customPaise = toPaise(custom);
  const customTooLow = customPaise !== null && customPaise < nextBid;
  const conditionLabel = product?.condition ? CONDITION_LABEL[product.condition] : null;

  return (
    <View style={styles.wrap}>
      {/* Who's ahead — real, straight off the auction doc. */}
      {(pendingAhead !== null || ((auction.bidCount || 0) > 0 && !!auction.currentBidderName)) && (
        <View style={styles.winningRow}>
          <View style={styles.winningAvatar}>
            <Text style={styles.winningInitial}>{leaderName.slice(0, 1).toLowerCase()}</Text>
          </View>
          <Text style={styles.winningText} numberOfLines={1}>
            {leaderName}{' '}
            <Text style={styles.winningAccent}>{amInLead ? 'are winning!' : 'is winning!'}</Text>
          </Text>
        </View>
      )}

      {/* Lot — thumbnail, three-line detail, price over countdown. */}
      <View style={styles.lotRow}>
        {/* Only render a thumbnail when there IS one. A live seller usually
            has the item on camera, and an empty placeholder square just eats
            width the title needs. */}
        {!!product?.thumbnail_url && (
          <Image source={{ uri: product.thumbnail_url }} style={styles.lotThumb} contentFit="cover" />
        )}

        <View style={{ flex: 1, gap: 1 }}>
          <Text style={styles.lotTitle} numberOfLines={2}>
            {product?.title || 'Live auction'}
          </Text>
          {!!conditionLabel && <Text style={styles.lotMeta}>{conditionLabel}</Text>}
          <Text style={styles.lotMeta}>
            {product?.shippingFee
              ? `${formatPaise(product.shippingFee)} Shipping`
              : 'Free shipping'}
          </Text>
        </View>

        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={styles.lotPrice}>
            {pendingAhead !== null || (auction.bidCount || 0) > 0
              ? formatPaise(shownBid)
              : formatPaise(auction.startPrice)}
          </Text>
          {open && (
            <View style={styles.clockRow}>
              {/* Sudden Death: the clock is hard, last bid in wins. Marked so a
                  buyer can see the rules of THIS lot at a glance. */}
              {auction.suddenDeath === true && <Text style={styles.skull}>💀</Text>}
              <Text style={[styles.lotClock, secondsLeft <= 15 && styles.lotClockHot]}>
                {clock(msLeft)}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Blocked: watching is fine, buying isn't. Kept to ONE line so it never
          steals the screen from the video — the full reason is a tap away. */}
      {open && !!blockedReason && (
        <Pressable
          onPress={() => onError(blockedReason)}
          accessibilityRole="button"
          accessibilityLabel={blockedReason}
          style={({ pressed }) => [styles.blocked, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="alert-circle-outline" size={14} color={TONE.live} />
          <Text style={styles.blockedText} numberOfLines={1}>
            {blockedShort}
          </Text>
          <Ionicons name="information-circle-outline" size={14} color={TONE.faint} />
        </Pressable>
      )}

      {open ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              setCustom('');
              setCustomOpen(true);
            }}
            disabled={bidding || msLeft <= 0 || !!blockedReason}
            accessibilityRole="button"
            accessibilityLabel="Bid a custom amount"
            style={({ pressed }) => [styles.customBtn, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.customText}>Custom</Text>
          </Pressable>

          <Pressable
            onPress={() => bid(nextBid)}
            disabled={bidding || msLeft <= 0 || !!blockedReason}
            accessibilityRole="button"
            accessibilityLabel={`Bid ${formatPaise(nextBid)}`}
            style={({ pressed }) => [
              styles.bidBtn,
              (bidding || msLeft <= 0 || !!blockedReason) && { opacity: 0.5 },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.bidText}>
              {/* No "Placing…" state: the optimistic bid has already moved the
                  price and this label to the NEXT increment, so replacing it
                  with a spinner-ish word just hid the thing that reassures the
                  bidder their tap landed. */}
              {blockedReason ? blockedShort : msLeft <= 0 ? 'Ending…' : `Bid: ${formatPaise(nextBid)}`}
            </Text>
            {msLeft > 0 && !blockedReason && (
              <View style={styles.chevrons}>
                <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
                <Ionicons name="chevron-forward" size={16} color="#FFFFFF" style={{ marginLeft: -9 }} />
              </View>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={styles.soldRow}>
          <Ionicons name="ribbon-outline" size={15} color={TONE.primary} />
          <Text style={styles.soldText}>
            {amInLead || auction.winnerUid === myUid
              ? 'You won! Complete payment to claim it.'
              : `Sold${auction.currentBidderName ? ` to ${auction.currentBidderName}` : ''} for ${formatPaise(auction.currentBid)}`}
          </Text>
        </View>
      )}

      {/* Custom bid */}
      <Modal visible={customOpen} transparent animationType="fade" onRequestClose={() => setCustomOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCustomOpen(false)} accessibilityLabel="Close" />
        <View style={styles.customSheet}>
          <Text style={styles.customTitle}>Your bid</Text>
          <Text style={styles.customBody}>Minimum {formatPaise(nextBid)}.</Text>
          <View style={styles.customField}>
            <Text style={styles.customPrefix}>₹</Text>
            <TextInput
              value={custom}
              onChangeText={(t) => setCustom(t.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder={String(Math.ceil(nextBid / 100))}
              placeholderTextColor={TONE.faint}
              style={styles.customInput}
              accessibilityLabel="Custom bid amount in rupees"
              autoFocus
            />
          </View>
          {customTooLow && (
            <Text style={styles.customError}>That’s below the minimum bid.</Text>
          )}
          <Pressable
            onPress={() => {
              if (customPaise === null || customTooLow) return;
              setCustomOpen(false);
              bid(customPaise);
            }}
            disabled={customPaise === null || customTooLow}
            accessibilityRole="button"
            accessibilityLabel="Place bid"
            style={({ pressed }) => [
              styles.bidBtn,
              (customPaise === null || customTooLow) && { opacity: 0.45 },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.bidText}>Place bid</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // No panel chrome: the reference lets the bottom gradient of the video be
  // the background, so the lot reads as part of the stream, not a card on it.
  wrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },

  winningRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  winningAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(24,36,64,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  winningInitial: { color: TONE.text, fontSize: 11.5, fontFamily: Fonts.sansSemiBold },
  winningText: { flex: 1, color: TONE.text, fontSize: 15, fontFamily: Fonts.sansSemiBold, ...SHADOW },
  winningAccent: { color: '#4DB8FF' },

  lotRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one },
  lotThumb: { width: 66, height: 66, borderRadius: 10 },
  lotThumbEmpty: {
    backgroundColor: 'rgba(20,36,70,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lotTitle: { color: TONE.text, fontSize: 18.5, fontFamily: Fonts.sansSemiBold, lineHeight: 23, ...SHADOW },
  lotMeta: { color: TONE.dim, fontSize: 14, fontFamily: Fonts.sans, ...SHADOW },
  lotPrice: { color: TONE.text, fontSize: 21, fontFamily: Fonts.sansSemiBold, ...SHADOW },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  skull: { fontSize: 13 },
  lotClock: { color: TONE.text, fontSize: 18, fontFamily: Fonts.mono, letterSpacing: 0.5, ...SHADOW },
  lotClockHot: { color: TONE.live },

  blocked: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  blockedText: { color: TONE.dim, fontSize: 12, fontFamily: Fonts.sansMedium },

  actions: { flexDirection: 'row', gap: Spacing.two + Spacing.one },
  customBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customText: { color: TONE.text, fontSize: 18, fontFamily: Fonts.sansSemiBold },
  bidBtn: {
    flex: 2,
    flexDirection: 'row',
    gap: 8,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: TONE.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bidText: { color: '#FFFFFF', fontSize: 18, fontFamily: Fonts.sansSemiBold },
  chevrons: { flexDirection: 'row', alignItems: 'center', marginLeft: -2 },

  soldRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingBottom: Spacing.one },
  soldText: { flex: 1, color: TONE.dim, fontSize: 13, fontFamily: Fonts.sans, ...SHADOW },

  backdrop: { ...(StyleSheet.absoluteFill as object), backgroundColor: 'rgba(2,6,16,0.7)' },
  customSheet: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    top: '32%',
    backgroundColor: '#0C1730',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: TONE.border,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  customTitle: { color: TONE.text, fontSize: 18, fontFamily: Fonts.sansSemiBold },
  customBody: { color: TONE.dim, fontSize: 13.5, fontFamily: Fonts.sans },
  customField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: TONE.border,
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    minHeight: 56,
  },
  customPrefix: { color: TONE.text, fontSize: 19, fontFamily: Fonts.sansSemiBold },
  customInput: { flex: 1, color: TONE.text, fontSize: 19, fontFamily: Fonts.sansSemiBold, padding: 0 },
  customError: { color: TONE.live, fontSize: 12.5, fontFamily: Fonts.sans },
});
