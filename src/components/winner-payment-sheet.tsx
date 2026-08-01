// Winner payment — mobile port of the web WinnerPaymentDrawer. Shown to the
// auction winner while status is awaiting_winner_payment: a hard countdown to
// paymentWindowExpiresAt, then Razorpay Checkout (WebView) and server-side
// verification. Expiry is enforced by the backend; the sheet only reports it.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { FormError, PrimaryButton, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  auctionPaymentExpired,
  createAuctionWinnerOrder,
  formatPaise,
  type AuctionRecord,
  type CommerceProfile,
} from '@/lib/commerce';
import { RazorpayCheckout, type CheckoutOrder } from '@/components/razorpay-checkout';
import { useSession } from '@/lib/session';

interface Props {
  auction: AuctionRecord;
  profile: CommerceProfile | null;
  onDone: () => void;
}

export function WinnerPaymentSheet({ auction, profile, onDone }: Props) {
  const c = useBrandColors();
  const { user } = useSession();

  const [order, setOrder] = useState<
    (CheckoutOrder & { productTitle?: string; paymentWindowExpiresAt?: string }) | null
  >(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [expired, setExpired] = useState(false);

  const expiresAt = order?.paymentWindowExpiresAt || auction.paymentWindowExpiresAt;
  const [secondsLeft, setSecondsLeft] = useState(() =>
    expiresAt ? Math.max(0, Math.ceil((Date.parse(String(expiresAt)) - Date.now()) / 1000)) : 0
  );

  useEffect(() => {
    if (!expiresAt || paid) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((Date.parse(String(expiresAt)) - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setExpired(true);
    };
    tick();
    const idInterval = setInterval(tick, 500);
    return () => clearInterval(idInterval);
  }, [expiresAt, paid]);

  useEffect(() => {
    if (!expired || paid) return;
    // Best-effort release so the seller can relist; backend applies grace.
    auctionPaymentExpired(auction.id).catch(() => {});
  }, [expired, paid, auction.id]);

  async function pay() {
    setBusy(true);
    setErr(null);
    try {
      const o = await createAuctionWinnerOrder(auction.id);
      setOrder(o);
      setCheckoutOpen(true);
    } catch (e: any) {
      const text = String(e?.message || '');
      if (text.includes('PAYMENT_WINDOW_EXPIRED')) setExpired(true);
      else {
        const m = text.match(/"message"\s*:\s*"([^"]+)"/);
        setErr(m?.[1] || 'Could not start the payment. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onDone}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
          {paid ? (
            <>
              <Ionicons name="checkmark-circle" size={44} color={c.primary} style={styles.icon} />
              <Text style={[styles.title, { color: c.text }]}>Payment confirmed</Text>
              <Text style={[styles.sub, { color: c.textSecondary }]}>
                {order?.productTitle ? `"${order.productTitle}" is yours. ` : 'It’s yours. '}
                Track it anytime under Orders.
              </Text>
              <PrimaryButton title="Back to the show" onPress={onDone} />
            </>
          ) : expired ? (
            <>
              <Ionicons name="hourglass-outline" size={44} color={c.danger} style={styles.icon} />
              <Text style={[styles.title, { color: c.text }]}>Payment window expired</Text>
              <Text style={[styles.sub, { color: c.textSecondary }]}>
                The reservation was released so the seller can relist. Unpaid wins can pause
                your bidding — reach out to support if this wasn't your fault.
              </Text>
              <PrimaryButton title="Close" variant="ghost" onPress={onDone} />
            </>
          ) : (
            <>
              <Ionicons name="trophy-outline" size={44} color={c.primary} style={styles.icon} />
              <Text style={[styles.title, { color: c.text }]}>You won!</Text>
              <Text style={[styles.sub, { color: c.textSecondary }]}>
                Winning bid {formatPaise(auction.currentBid)}. Complete payment before the
                timer runs out to claim it.
              </Text>

              <View
                style={[
                  styles.timer,
                  {
                    borderColor: secondsLeft <= 15 ? c.live : c.border,
                    backgroundColor: secondsLeft <= 15 ? 'rgba(230,57,70,0.12)' : c.background,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.timerText,
                    { color: secondsLeft <= 15 ? c.live : c.text },
                  ]}
                >
                  {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                </Text>
                <Text style={[styles.timerLabel, { color: c.textSecondary }]}>TO PAY</Text>
              </View>

              <FormError message={err} />
              <PrimaryButton
                title={`Pay ${formatPaise(auction.currentBid)} now`}
                onPress={pay}
                loading={busy}
              />
              <Pressable onPress={onDone} hitSlop={8} style={styles.later}>
                <Text style={{ color: c.textSecondary, fontFamily: Fonts.sans, fontSize: 13 }}>
                  Hide (the timer keeps running)
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>

      <RazorpayCheckout
        visible={checkoutOpen}
        order={order}
        description={order?.productTitle || 'Auction win'}
        prefill={{
          name: user?.displayName || undefined,
          email: user?.email || undefined,
          contact: profile?.savedAddress?.phone || undefined,
        }}
        preferredMethod={profile?.preferredMethod || undefined}
        onSuccess={() => {
          setCheckoutOpen(false);
          setPaid(true);
        }}
        onDismiss={() => setCheckoutOpen(false)}
        onError={(message) => {
          setCheckoutOpen(false);
          setErr(message);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(2,6,16,0.78)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
    alignItems: 'stretch',
  },
  icon: { alignSelf: 'center' },
  title: {
    fontSize: 24,
    fontFamily: Fonts.sansSemiBold,
    textAlign: 'center',
  },
  sub: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 20, textAlign: 'center' },
  timer: {
    alignSelf: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + Spacing.one,
    gap: 2,
  },
  timerText: { fontFamily: Fonts.mono, fontSize: 30 },
  timerLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 2 },
  later: { alignSelf: 'center', paddingVertical: Spacing.one },
});
