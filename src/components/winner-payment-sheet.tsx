// Winner payment — mobile port of the web WinnerPaymentDrawer. Shown to the
// auction winner while status is awaiting_winner_payment: a hard countdown to
// paymentWindowExpiresAt, then Razorpay Checkout (WebView) and server-side
// verification. Expiry is enforced by the backend; the sheet only reports it.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { FormError, PrimaryButton, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  auctionPaymentExpired,
  createAuctionWinnerOrder,
  formatPaise,
  type AuctionRecord,
  type CommerceProfile,
} from '@/lib/commerce';
import { discountAmountPaise, spendableCredit } from '@/lib/credits';
import { RazorpayCheckout, type CheckoutOrder } from '@/components/razorpay-checkout';
import { reauth as reauthAuctionEngine } from '@/lib/auction-socket';
import { useSession } from '@/lib/session';

interface Props {
  auction: AuctionRecord;
  profile: CommerceProfile | null;
  onDone: () => void;
}

export function WinnerPaymentSheet({ auction, profile, onDone }: Props) {
  const c = useBrandColors();
  const { user } = useSession();

  // What Razorpay will actually charge. Settlement mirrors these onto the
  // auction doc for exactly this drawer; the fallbacks cover a doc written by
  // a pre-mirror backend, where shipping is unknown and the bid is the best
  // honest number.
  const bidAmount = auction.winningBidAmount ?? auction.currentBid;
  const shippingFee = auction.winningShippingFee ?? 0;
  const totalAmount = auction.winningTotalAmount ?? bidAmount + shippingFee;

  const [order, setOrder] = useState<
    | (CheckoutOrder & {
        productTitle?: string;
        paymentWindowExpiresAt?: string;
        creditApplied?: number;
        firstBuyDiscount?: number | { amountPaise?: number; percent?: number } | null;
      })
    | null
  >(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [expired, setExpired] = useState(false);
  // Spend referral credit on this win (spec Gap 6). Off by default — spending
  // a balance is always the winner's explicit choice.
  const [useCredit, setUseCredit] = useState(false);

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

  // Preview only — the server's transaction decides the real deduction
  // (min(balance, total − ₹1)); the order it returns carries the actual
  // `creditApplied`, which is what the breakdown lines below render.
  const creditPreview = spendableCredit(profile?.creditPaise ?? 0, totalAmount);

  async function pay() {
    setBusy(true);
    setErr(null);
    try {
      const o = await createAuctionWinnerOrder(auction.id, undefined, useCredit && creditPreview > 0);
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
                your bidding — reach out to support if this wasn’t your fault.
              </Text>
              <PrimaryButton title="Close" variant="ghost" onPress={onDone} />
            </>
          ) : (
            <>
              <Ionicons name="trophy-outline" size={44} color={c.primary} style={styles.icon} />
              <Text style={[styles.title, { color: c.text }]}>You won!</Text>
              <Text style={[styles.sub, { color: c.textSecondary }]}>
                Winning bid {formatPaise(bidAmount)}
                {shippingFee > 0 ? ` + ${formatPaise(shippingFee)} shipping` : ''}. Complete
                payment before the timer runs out to claim it.
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

              {/* Referral credit (spec Gap 6) — only when a real balance exists. */}
              {creditPreview > 0 && !order && (
                <View
                  style={[
                    styles.creditRow,
                    { borderColor: c.border, backgroundColor: c.background },
                  ]}
                >
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={[styles.creditTitle, { color: c.text }]}>
                      Use {formatPaise(creditPreview)} credit
                    </Text>
                    <Text style={[styles.creditBody, { color: c.textSecondary }]}>
                      Applied when the payment is created — Razorpay charges the remainder (₹1
                      minimum).
                    </Text>
                  </View>
                  <Switch
                    value={useCredit}
                    onValueChange={setUseCredit}
                    accessibilityLabel={`Use ${formatPaise(creditPreview)} credit on this payment`}
                    trackColor={{ false: 'rgba(120,150,210,0.35)', true: c.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              )}

              {/* Server-confirmed breakdown once the order exists — these are
                  the amounts the backend actually recorded, never estimates. */}
              {!!order &&
                ((order.creditApplied || 0) > 0 ||
                  discountAmountPaise(order.firstBuyDiscount) > 0) && (
                  <View style={[styles.breakdown, { borderColor: c.border }]}>
                    {(order.creditApplied || 0) > 0 && (
                      <Text style={[styles.breakdownLine, { color: c.textSecondary }]}>
                        Credit applied −{formatPaise(order.creditApplied || 0)}
                      </Text>
                    )}
                    {discountAmountPaise(order.firstBuyDiscount) > 0 && (
                      <Text style={[styles.breakdownLine, { color: c.textSecondary }]}>
                        First-purchase discount −
                        {formatPaise(discountAmountPaise(order.firstBuyDiscount))}
                      </Text>
                    )}
                    <Text style={[styles.breakdownLine, { color: c.text }]}>
                      Razorpay charges {formatPaise(order.amount)}
                    </Text>
                  </View>
                )}

              <FormError message={err} />
              <PrimaryButton
                title={order ? `Pay ${formatPaise(order.amount)} now` : `Pay ${formatPaise(totalAmount)} now`}
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
          // Paying releases the unpaid-wins hold, but the engine judged this
          // bidder with the context it cached at socket auth — reconnect so
          // the next bid isn't rejected with the stale BID_BLOCKED_UNPAID.
          reauthAuctionEngine();
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
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 10,
    padding: Spacing.three,
  },
  creditTitle: { fontSize: 14, fontFamily: Fonts.sansMedium },
  creditBody: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 16 },
  breakdown: {
    borderWidth: 1,
    borderRadius: 10,
    padding: Spacing.two + Spacing.one,
    gap: 3,
  },
  breakdownLine: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18, textAlign: 'center' },
});
