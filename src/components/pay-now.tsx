// Pay a pending order that was created FOR the buyer — an accepted offer:
// the acceptance ran on the seller's device, so no checkout params ever
// reached this buyer. (A buy-now order whose checkout was dismissed carries
// the same fields, so this path revives those too.)
//
// The order rows (GET /api/orders/mine, GET /api/orders/:id) carry
// rzpOrderId + amount + paymentWindowExpiresAt for exactly this; the public
// keyId comes from GET /api/payments/config, and RazorpayCheckout then runs
// the normal server-verified flow (it calls /api/payments/verify itself on
// the success payload — the client never decides whether a payment worked).
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { RazorpayCheckout, type CheckoutOrder } from '@/components/razorpay-checkout';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import type { BuyerOrder } from '@/lib/api';
import { formatPaise, getPaymentsConfig } from '@/lib/commerce';
import { auth } from '@/lib/firebase';
import { msUntil } from '@/lib/server-time';

/** Does this order carry an open payment window the buyer can still pay?
 *  pending_payment + a real Razorpay order + an unexpired window. Zero-amount
 *  orders (giveaway wins) are never payable — there is nothing to charge. */
export function orderAwaitingPayment(
  order: Pick<BuyerOrder, 'status' | 'rzpOrderId' | 'amount' | 'paymentWindowExpiresAt'>
): boolean {
  return (
    order.status === 'pending_payment' &&
    !!order.rzpOrderId &&
    (order.amount ?? 0) > 0 &&
    !!order.paymentWindowExpiresAt &&
    msUntil(order.paymentWindowExpiresAt) > 0
  );
}

/** ms → "12m 30s" / "45s" — payment windows are minutes, never hours. */
function formatPayLeft(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

/** "Pay ₹X" + live countdown for an order the buyer still owes payment on.
 *  Owns the whole flow: keyId fetch → RazorpayCheckout → (component-internal)
 *  /verify → onPaid. Renders nothing actionable once the window lapses —
 *  the server expires the order on its own clock. */
export function PayNowButton({
  order,
  onPaid,
}: {
  order: BuyerOrder;
  /** Server-verified payment landed — refetch whatever list this sits in. */
  onPaid: () => void;
}) {
  const c = useBrandColors();
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutOrder | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 1s tick against the SERVER clock (msUntil) — same idiom as the auction
  // countdown, so every device shows the same deadline.
  const expiresAt = order.paymentWindowExpiresAt || null;
  const [msLeft, setMsLeft] = useState(() => msUntil(expiresAt));
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setMsLeft(msUntil(expiresAt));
    tick();
    const idInterval = setInterval(tick, 1000);
    return () => clearInterval(idInterval);
  }, [expiresAt]);

  // Stable across renders so the checkout's memoised HTML never rebuilds
  // mid-payment on a countdown tick (a new prefill object would re-run the
  // WebView source memo every second).
  const prefill = useMemo(
    () => ({
      name: auth.currentUser?.displayName || undefined,
      email: auth.currentUser?.email || undefined,
    }),
    []
  );

  const expired = msLeft <= 0;

  async function payNow() {
    if (busy || checkout || !order.rzpOrderId) return;
    setBusy(true);
    setErr(null);
    try {
      // Only the PUBLIC key id is missing client-side — the Razorpay order
      // already exists on the order row.
      const config = await getPaymentsConfig();
      setCheckout({
        orderId: order.rzpOrderId,
        amount: order.amount,
        currency: order.currency || 'INR',
        keyId: config.keyId,
      });
    } catch {
      setErr('Couldn’t start the payment — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {!expired ? (
        <Pressable
          onPress={payNow}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Pay ${formatPaise(order.amount)} for this order now`}
          style={({ pressed }) => [
            styles.btn,
            { backgroundColor: c.cta, opacity: pressed || busy ? 0.75 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={c.ctaText} />
          ) : (
            <>
              <Ionicons name="card-outline" size={15} color={c.ctaText} />
              <Text style={[styles.btnText, { color: c.ctaText }]}>
                Pay {formatPaise(order.amount)} · {formatPayLeft(msLeft)} left
              </Text>
            </>
          )}
        </Pressable>
      ) : (
        <Text style={[styles.expiredText, { color: c.textFaint }]}>
          The payment window for this order has ended.
        </Text>
      )}
      {!!err && <Text style={[styles.errText, { color: c.danger }]}>{err}</Text>}

      <RazorpayCheckout
        visible={!!checkout}
        order={checkout}
        description={order.productTitle || 'Any&All order'}
        prefill={prefill}
        onSuccess={() => {
          setCheckout(null);
          setErr(null);
          onPaid();
        }}
        onDismiss={() => setCheckout(null)}
        onError={(message) => {
          setCheckout(null);
          setErr(message);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
  },
  btnText: { fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  expiredText: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },
  errText: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },
});
