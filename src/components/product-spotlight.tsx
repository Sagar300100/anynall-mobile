// Buy Now spotlight — the bottom panel of the live room when no auction lot is
// running. Sellers pin one product at a time server-side (`pinned`); we show
// the first in-stock pinned buy-it-now product, falling back to any in-stock
// buy-it-now item so the panel isn't empty mid-show.
//
// It deliberately shares the live lot's anatomy — thumbnail, title, condition,
// shipping, price on the right, one full-width action — so the bottom of the
// screen doesn't change shape when a lot starts and ends.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { formatPaise } from '@/lib/commerce';
import { activeFlashSale, type ProductDoc } from '@/lib/realtime';
import { msUntil } from '@/lib/server-time';

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

export function availableUnits(p: ProductDoc): number {
  return Math.max(0, (p.stock || 0) - (p.reserved || 0) - (p.sold || 0));
}

/** The product the spotlight should feature right now, or null. */
export function pickSpotlight(products: ProductDoc[]): ProductDoc | null {
  const buyable = products.filter(
    (p) => (p.kind || 'buy-it-now') === 'buy-it-now' && availableUnits(p) > 0
  );
  return buyable.find((p) => p.pinned) || buyable[0] || null;
}

/** "4:59" — flash countdowns are minutes-scale, so no leading zero pad on
 *  the minutes the way the auction clock does. */
export function flashClock(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The product's RUNNING flash sale with a live ms-remaining, or null.
 *
 * Ticks once a second against the SERVER-corrected clock (msUntil), exactly
 * like the auction countdown — endsAt is a server timestamp, and a device
 * clock a few seconds off must not show a flash as over (or still on) when
 * it isn't. The tick's own re-render is what retires the flash at zero:
 * activeFlashSale() re-evaluates and returns null, so callers simply render
 * the plain price again. The server re-checks endsAt at charge time; this
 * hook only makes the DISPLAY honest.
 */
export function useFlashSale(
  product: Pick<ProductDoc, 'flashSale' | 'price'>
): { pricePaise: number; endsAt: string; msLeft: number } | null {
  const flash = activeFlashSale(product);
  const endsAt = flash?.endsAt ?? null;
  const [msLeft, setMsLeft] = useState(() => msUntil(endsAt));
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setMsLeft(msUntil(endsAt));
    tick();
    const idInterval = setInterval(tick, 1000);
    return () => clearInterval(idInterval);
  }, [endsAt]);
  if (!flash) return null;
  return { pricePaise: flash.pricePaise, endsAt: flash.endsAt, msLeft };
}

export function ProductSpotlight({
  product,
  onBuy,
  blockedReason,
  blockedLabel,
}: {
  product: ProductDoc;
  onBuy: () => void;
  /** Set when the server says this buyer can't purchase from this seller — Buy
   *  is frozen and the reason shown, rather than failing at checkout. */
  blockedReason?: string | null;
  /** Short wording for the pill and the button; the reason is the sentence. */
  blockedLabel?: string | null;
}) {
  const left = availableUnits(product);
  const blockedShort = blockedLabel || 'Buying unavailable';
  const conditionLabel = product.condition ? CONDITION_LABEL[product.condition] : null;
  // Flash sale (Gap 8): while product.flashSale is running, the list price is
  // struck through, the flash price takes its place, and a mm:ss chip counts
  // down on the server clock. The server charges the flash price regardless —
  // this is the display half of that contract.
  const flash = useFlashSale(product);
  const displayPrice = flash ? flash.pricePaise : product.price || 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {!!product.thumbnail_url && (
          <Image source={{ uri: product.thumbnail_url }} style={styles.thumb} contentFit="cover" />
        )}

        <View style={{ flex: 1, gap: 1 }}>
          <Text numberOfLines={2} style={styles.title}>
            {product.title}
          </Text>
          {!!conditionLabel && <Text style={styles.meta}>{conditionLabel}</Text>}
          <Text style={styles.meta}>
            {product.shippingFee ? `${formatPaise(product.shippingFee)} Shipping` : 'Free shipping'}
          </Text>
        </View>

        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          {flash && <Text style={styles.strike}>{formatPaise(product.price || 0)}</Text>}
          <Text style={[styles.price, flash && styles.flashPrice]}>
            {formatPaise(displayPrice)}
          </Text>
          {flash && (
            <View style={styles.flashChip}>
              <Ionicons name="flash" size={12} color="#FFD166" />
              <Text style={styles.flashChipText}>{flashClock(flash.msLeft)}</Text>
            </View>
          )}
          {left <= 3 && <Text style={styles.left}>{left} left</Text>}
        </View>
      </View>

      {/* Blocked: watching is fine, buying isn't. One line, so it never steals
          the screen from the video. */}
      {!!blockedReason && (
        <View style={styles.blocked}>
          <Ionicons name="alert-circle-outline" size={14} color="#FF6B6B" />
          <Text style={styles.blockedText} numberOfLines={1}>
            {blockedShort}
          </Text>
        </View>
      )}

      <Pressable
        onPress={onBuy}
        disabled={!!blockedReason}
        accessibilityRole="button"
        accessibilityLabel={blockedReason || 'Buy now'}
        accessibilityState={{ disabled: !!blockedReason }}
        style={({ pressed }) => [
          styles.buyBtn,
          blockedReason ? { opacity: 0.5 } : pressed ? { opacity: 0.85 } : null,
        ]}
      >
        {/* In-room CTA fill (spec §6.6): 135° #1E6FFF→#4DB8FF under the
            existing content — colour change only, layout untouched. */}
        <LinearGradient
          colors={['#1E6FFF', '#4DB8FF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.buyText}>
          {blockedReason ? blockedShort : `Buy: ${formatPaise(displayPrice)}`}
        </Text>
        {!blockedReason && (
          <View style={styles.chevrons}>
            <Ionicons name="chevron-forward" size={17} color="#04122B" />
            <Ionicons name="chevron-forward" size={17} color="#04122B" style={{ marginLeft: -9 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one },
  thumb: { width: 66, height: 66, borderRadius: 10 },
  title: { color: '#FFFFFF', fontSize: 18.5, fontFamily: Fonts.sansSemiBold, lineHeight: 23, ...SHADOW },
  meta: { color: 'rgba(159,180,216,0.9)', fontSize: 14, fontFamily: Fonts.sans, ...SHADOW },
  // Prices render in the sky-blue accent (spec §6.6); the flash-sale amber
  // override below still wins while a flash runs.
  price: { color: '#4DB8FF', fontSize: 21, fontFamily: Fonts.sansSemiBold, ...SHADOW },
  left: { color: '#FF6B6B', fontSize: 13, fontFamily: Fonts.sansMedium, ...SHADOW },

  // ── Flash sale ────────────────────────────────────────────────────────
  strike: {
    color: 'rgba(214,224,242,0.75)',
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
    textDecorationLine: 'line-through',
    ...SHADOW,
  },
  flashPrice: { color: '#FFD166' },
  flashChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(24,32,52,0.8)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  flashChipText: { color: '#FFD166', fontSize: 12.5, fontFamily: Fonts.sansSemiBold },

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
  blockedText: { color: 'rgba(159,180,216,0.9)', fontSize: 12, fontFamily: Fonts.sansMedium },

  buyBtn: {
    flexDirection: 'row',
    gap: 8,
    minHeight: 56,
    borderRadius: 999,
    // Fill is the in-room CTA gradient rendered inside (spec §6.6); overflow
    // hidden clips it to the pill.
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Navy on the bright gradient (spec §6.6) — white failed contrast on #4DB8FF.
  buyText: { color: '#04122B', fontSize: 18, fontFamily: Fonts.sansSemiBold },
  chevrons: { flexDirection: 'row', alignItems: 'center', marginLeft: -2 },
});
