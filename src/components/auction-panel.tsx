// Live auction panel — floats above the chat composer in the live room.
// State streams from the Firestore auction doc (listenAuctions); every write
// goes through the HTTP API. The countdown is display-only: when it hits zero
// any participant calls /finalize and the backend transaction decides.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  finalizeAuction,
  formatPaise,
  minNextBid,
  newIdempotencyKey,
  placeBid,
  type AuctionRecord,
} from '@/lib/commerce';
import type { ProductDoc } from '@/lib/realtime';

interface Props {
  auction: AuctionRecord;
  product?: ProductDoc | null;
  myUid?: string | null;
  /** Gate: resolves true when the buyer may bid (profile ready), false when
   *  setup UI was opened instead — the panel then skips the bid call. */
  ensureReady: () => Promise<boolean>;
  onError: (message: string) => void;
}

function useCountdown(endsAt?: string | null) {
  const [msLeft, setMsLeft] = useState(() =>
    endsAt ? Math.max(0, Date.parse(endsAt) - Date.now()) : 0
  );
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setMsLeft(Math.max(0, Date.parse(endsAt) - Date.now()));
    tick();
    const idInterval = setInterval(tick, 250);
    return () => clearInterval(idInterval);
  }, [endsAt]);
  return msLeft;
}

export function AuctionPanel({ auction, product, myUid, ensureReady, onError }: Props) {
  const c = useBrandColors();
  const msLeft = useCountdown(auction.endsAt);
  const [bidding, setBidding] = useState(false);
  // One finalize call per auction version — the backend is idempotent, this
  // just avoids hammering it 4×/second from the display tick.
  const finalizedFor = useRef<string | null>(null);

  const open = auction.status === 'open';
  const secondsLeft = Math.ceil(msLeft / 1000);
  const amInLead = !!myUid && auction.currentBidderUid === myUid;
  const nextBid = minNextBid(auction);

  useEffect(() => {
    if (!open || msLeft > 0) return;
    const key = `${auction.id}:${auction.version || 0}`;
    if (finalizedFor.current === key) return;
    finalizedFor.current = key;
    finalizeAuction(auction.id).catch(() => {
      // AUCTION_STILL_LIVE / races are normal — Firestore will push the truth.
    });
  }, [open, msLeft, auction.id, auction.version]);

  async function bid() {
    if (bidding) return;
    setBidding(true);
    try {
      const ready = await ensureReady();
      if (!ready) return;
      await placeBid(auction.id, nextBid, newIdempotencyKey());
    } catch (err: any) {
      const text = String(err?.message || '');
      // Friendly messages come through in the response body (HTTP 409 ...).
      const m = text.match(/"message"\s*:\s*"([^"]+)"/);
      onError(m?.[1] || 'Your bid didn’t go through — try again.');
    } finally {
      setBidding(false);
    }
  }

  if (!open && auction.status !== 'awaiting_winner_payment') return null;

  return (
    <View style={[styles.card, { backgroundColor: 'rgba(10,20,40,0.92)', borderColor: c.border }]}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[styles.product, { color: c.text }]}>
            {product?.title || 'Live auction'}
          </Text>
          <Text style={[styles.bidLine, { color: c.textSecondary }]}>
            {(auction.bidCount || 0) > 0 ? (
              <>
                {formatPaise(auction.currentBid)}
                {auction.currentBidderName ? ` · ${amInLead ? 'you lead!' : auction.currentBidderName}` : ''}
              </>
            ) : (
              <>Starts at {formatPaise(auction.startPrice)}</>
            )}
          </Text>
        </View>
        {open && (
          <View
            style={[
              styles.timer,
              {
                backgroundColor: secondsLeft <= 10 ? 'rgba(230,57,70,0.18)' : c.backgroundSelected,
                borderColor: secondsLeft <= 10 ? c.live : c.border,
              },
            ]}
          >
            <Ionicons name="time-outline" size={13} color={secondsLeft <= 10 ? c.live : c.textSecondary} />
            <Text
              style={[
                styles.timerText,
                { color: secondsLeft <= 10 ? c.live : c.text },
              ]}
            >
              {secondsLeft}s
            </Text>
          </View>
        )}
      </View>

      {open ? (
        <Pressable
          onPress={bid}
          disabled={bidding || msLeft <= 0}
          style={({ pressed }) => [
            styles.bidBtn,
            {
              backgroundColor: amInLead ? c.backgroundSelected : c.cta,
              opacity: pressed || bidding || msLeft <= 0 ? 0.7 : 1,
              borderWidth: amInLead ? 1 : 0,
              borderColor: c.borderStrong,
            },
          ]}
        >
          <Text style={[styles.bidBtnText, { color: amInLead ? c.text : c.ctaText }]}>
            {msLeft <= 0
              ? 'Ending…'
              : bidding
                ? 'Placing…'
                : amInLead
                  ? `You lead — raise to ${formatPaise(nextBid)}`
                  : `Bid ${formatPaise(nextBid)}`}
          </Text>
        </Pressable>
      ) : (
        <View style={[styles.soldRow, { borderColor: c.border }]}>
          <Ionicons name="ribbon-outline" size={15} color={c.primary} />
          <Text style={[styles.soldText, { color: c.textSecondary }]}>
            {amInLead || auction.winnerUid === myUid
              ? 'You won! Complete payment to claim it.'
              : `Sold${auction.currentBidderName ? ` to ${auction.currentBidderName}` : ''} for ${formatPaise(auction.currentBid)}`}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two + Spacing.one,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  product: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
  bidLine: { fontSize: 13, fontFamily: Fonts.sans, marginTop: 1 },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
  },
  timerText: { fontFamily: Fonts.mono, fontSize: 13 },
  bidBtn: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  bidBtnText: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  soldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  soldText: { fontSize: 13, fontFamily: Fonts.sans, flex: 1 },
});
