// Razorpay Checkout inside a WebView — the Expo Go-compatible counterpart of
// the web app's openRazorpayCheckout (services/payments.ts). checkout.js only
// runs in a browser context, so we host it in a WebView and relay the result
// back over postMessage. The success payload is then HMAC-verified server-side
// (/api/payments/verify) exactly like the web flow — the client never decides
// whether a payment "worked".
import { useMemo, useRef } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { verifyPayment, type VerifyPayload, type VerifyResult } from '@/lib/commerce';

// react-native-webview is native-only (no web implementation) — the Expo web
// preview must not even require it. On web we show a "use the app" fallback;
// real checkout always happens on the device.
const WebView: any =
  Platform.OS === 'web' ? null : require('react-native-webview').WebView;

export interface CheckoutOrder {
  orderId: string;
  amount: number; // paise
  currency: string;
  keyId: string;
  customerId?: string | null;
}

interface Props {
  visible: boolean;
  order: CheckoutOrder | null;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  preferredMethod?: 'upi' | 'card' | null;
  /** Server-verified success. */
  onSuccess: (verified: VerifyResult) => void;
  /** Buyer closed checkout without paying. */
  onDismiss: () => void;
  /** Verification or checkout failure worth surfacing. */
  onError: (message: string) => void;
}

function buildHtml(order: CheckoutOrder, opts: {
  description: string;
  prefill: { name?: string; email?: string; contact?: string };
  preferredMethod?: 'upi' | 'card' | null;
}): string {
  // Same Checkout options as the web client, including the saved-method
  // fast path (config.display) and remember_customer for returning buyers.
  const options: Record<string, any> = {
    key: order.keyId,
    order_id: order.orderId,
    amount: order.amount,
    currency: order.currency,
    name: 'Any&All',
    description: opts.description,
    theme: { color: '#1e6fff' },
    prefill: {
      ...(opts.prefill.name ? { name: opts.prefill.name } : {}),
      ...(opts.prefill.email ? { email: opts.prefill.email } : {}),
      ...(opts.prefill.contact ? { contact: opts.prefill.contact } : {}),
      ...(opts.preferredMethod ? { method: opts.preferredMethod } : {}),
    },
    ...(order.customerId ? { customer_id: order.customerId, remember_customer: true } : {}),
    ...(opts.preferredMethod
      ? {
          config: {
            display: {
              blocks: {
                preferred: {
                  name: opts.preferredMethod === 'upi' ? 'Pay via UPI' : 'Pay via Card',
                  instruments: [{ method: opts.preferredMethod }],
                },
              },
              sequence: ['block.preferred'],
              preferences: { show_default_blocks: false },
            },
          },
        }
      : {}),
  };

  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#050A18}</style>
</head>
<body>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  var post = function (msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };
  try {
    var options = ${JSON.stringify(options)};
    options.handler = function (response) { post({ type: 'success', payload: response }); };
    options.modal = {
      ondismiss: function () { post({ type: 'dismiss' }); },
      // Checkout is the whole screen here — escape should close it too.
      escape: true,
    };
    var rzp = new Razorpay(options);
    rzp.on('payment.failed', function (resp) {
      post({ type: 'failed', message: (resp && resp.error && resp.error.description) || '' });
    });
    rzp.open();
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
</script>
</body>
</html>`;
}

export function RazorpayCheckout({
  visible,
  order,
  description = 'Any&All order',
  prefill = {},
  preferredMethod,
  onSuccess,
  onDismiss,
  onError,
}: Props) {
  const c = useBrandColors();
  // Guards the race where Razorpay fires ondismiss right after handler.
  const settled = useRef(false);

  const html = useMemo(() => {
    if (!order) return '';
    settled.current = false;
    return buildHtml(order, { description, prefill, preferredMethod });
  }, [order, description, prefill, preferredMethod]);

  async function handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (settled.current) return;

    if (msg.type === 'success') {
      settled.current = true;
      try {
        const verified = await verifyPayment(msg.payload as VerifyPayload);
        onSuccess(verified);
      } catch (err: any) {
        onError(
          'Payment was received but could not be confirmed yet. If money left your account it is safe — check Orders in a minute.'
        );
        console.warn('[checkout] verify failed:', err?.message);
      }
      return;
    }
    if (msg.type === 'dismiss') {
      settled.current = true;
      onDismiss();
      return;
    }
    if (msg.type === 'failed') {
      // Razorpay keeps its own modal open for retry — just log, don't settle.
      console.warn('[checkout] payment.failed:', msg.message);
      return;
    }
    if (msg.type === 'error') {
      settled.current = true;
      onError(msg.message || 'Checkout could not start. Please try again.');
    }
  }

  return (
    <Modal
      visible={visible && !!order}
      animationType="slide"
      transparent={false}
      onRequestClose={() => {
        if (!settled.current) {
          settled.current = true;
          onDismiss();
        }
      }}
    >
      <View style={[styles.root, { backgroundColor: c.background }]}>
        {!WebView && (
          <View style={styles.loading}>
            <Text style={{ color: c.textSecondary, fontFamily: Fonts.sans, padding: Spacing.four, textAlign: 'center' }}>
              Checkout opens in the Any&All app on your phone.
            </Text>
          </View>
        )}
        {!!WebView && !!html && (
          <WebView
            originWhitelist={['*']}
            source={{ html, baseUrl: 'https://anynall.com' }}
            onMessage={(e: { nativeEvent: { data: string } }) => handleMessage(e.nativeEvent.data)}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={[styles.loading, { backgroundColor: c.background }]}>
                <ActivityIndicator size="large" color={c.primary} />
              </View>
            )}
            style={{ backgroundColor: c.background }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
