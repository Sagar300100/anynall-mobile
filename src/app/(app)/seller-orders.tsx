// Orders & shipments — mobile port of the website's sellerhub ShipmentsPanel.
// Replaces the Seller Tools "Orders" / "Fulfilment" stubs with the real thing.
//
// Everything a sold order needs, in one place:
//   paid, no courier → "Ship this order" books the Shiprocket pipeline
//                      (create → AWB → label; resumable — the server persists
//                      each step, so retrying never double-books)
//   booked           → courier + AWB, "Print label" (opens the PDF),
//                      "Request pickup", "Track" (inline latest status)
//
// PRIVACY, same as the server: the buyer's street address and phone are never
// returned here — city/State/PIN is enough for the seller to recognise the
// order. The full address rides on the courier label only.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import { humanizeStatus } from '@/lib/commerce';
import { getSellingOrders, ORDER_STATUS, type SellingOrder } from '@/lib/seller-hub';
import { getShippingStatus, requestPickup, shipOrder, trackOrder, SHIP_STAGE } from '@/lib/shipping';

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    // j() throws "HTTP 409 {json}" — surface the server's own sentence.
    const m = err.message.match(/"message"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
  }
  return fallback;
}

export default function SellerOrdersScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [orders, setOrders] = useState<SellingOrder[] | null>(null);
  const [pickupReady, setPickupReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ord, ship] = await Promise.all([getSellingOrders(), getShippingStatus()]);
      setOrders(Array.isArray(ord?.orders) ? ord.orders : []);
      setPickupReady(!!ship?.pickupRegistered);
      setError(null);
    } catch {
      setError('Couldn’t load your orders. Check your connection and try again.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (status !== 'member') return;
      let cancelled = false;
      (async () => {
        if (!cancelled) await load();
      })();
      return () => {
        cancelled = true;
      };
    }, [status, load])
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/seller-tools'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Orders & shipments</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="receipt-outline"
          title="Sign in to see your sales"
          body="Orders from your shows appear here, ready to ship."
          reason="sell"
        />
      ) : orders === null && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />
          }
        >
          {!!error && (
            <View style={[styles.errorBox, { borderColor: 'rgba(229,72,77,0.25)' }]}>
              <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
            </View>
          )}

          {!pickupReady && (
            <Pressable
              onPress={() => router.push('/shipping-settings')}
              accessibilityRole="button"
              accessibilityLabel="Set up your pickup address"
              style={({ pressed }) => [
                styles.setupBar,
                { borderColor: 'rgba(255,196,107,0.35)', opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={17} color="#FFC46B" />
              <Text style={[styles.setupText, { color: c.text }]}>
                Add your pickup address before booking couriers — tap to set it up.
              </Text>
              <Ionicons name="chevron-forward" size={15} color={c.textFaint} />
            </Pressable>
          )}

          {orders !== null && orders.length === 0 && !error && (
            <View style={[styles.empty, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              <Ionicons name="cube-outline" size={32} color={c.textFaint} />
              <Text style={[styles.emptyTitle, { color: c.text }]}>No orders yet</Text>
              <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
                When buyers purchase from your shows, each order lands here ready to ship.
              </Text>
            </View>
          )}

          {(orders || []).map((o) => (
            <OrderCard key={o.id} order={o} pickupReady={pickupReady} onChanged={load} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function OrderCard({
  order,
  pickupReady,
  onChanged,
}: {
  order: SellingOrder;
  pickupReady: boolean;
  onChanged: () => Promise<void>;
}) {
  const c = useBrandColors();
  const [busy, setBusy] = useState<'ship' | 'pickup' | 'track' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tracking, setTracking] = useState<string | null>(null);

  const shipment = order.shipment;
  const paid = order.status === 'paid';
  const shippingFee = order.pricing?.shippingFee;

  async function run(kind: 'ship' | 'pickup' | 'track') {
    if (busy) return;
    setBusy(kind);
    setErr(null);
    try {
      if (kind === 'ship') {
        await shipOrder(order.id);
        await onChanged();
      } else if (kind === 'pickup') {
        await requestPickup(order.id);
        await onChanged();
      } else {
        const r = await trackOrder(order.id);
        setTracking(
          r?.tracking?.status
            ? `${r.tracking.status}${r.tracking.etd ? ` · ETA ${r.tracking.etd}` : ''}`
            : 'No tracking updates yet.'
        );
      }
    } catch (e) {
      setErr(apiMessage(e, 'That didn’t go through — try again.'));
    } finally {
      setBusy(null);
    }
  }

  // Shipment stage beats raw order status once booking starts.
  const stage = shipment?.status ? SHIP_STAGE[shipment.status] : null;
  const statusMeta = ORDER_STATUS[order.status] || { label: humanizeStatus(order.status), tone: 'muted' as const };
  const pillLabel = stage || (paid ? 'Paid · ready to ship' : statusMeta.label);
  const pillColor = stage ? '#7CE0A8' : paid ? c.primary : statusMeta.tone === 'bad' ? c.danger : statusMeta.tone === 'warn' ? '#FFC46B' : c.textSecondary;

  return (
    <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
      <View style={styles.cardHead}>
        <View style={styles.cardHeadText}>
          <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={2}>
            {order.productTitle}
          </Text>
          <Text style={[styles.cardMeta, { color: c.textSecondary }]} numberOfLines={1}>
            {order.buyerName ? `${order.buyerName} · ` : ''}
            {order.destination
              ? `${order.destination.city || ''}${order.destination.stateCode ? `, ${order.destination.stateCode}` : ''} — ${order.destination.pincode || ''}`
              : 'No address'}
          </Text>
          <Text style={[styles.cardMeta, { color: c.textSecondary }]}>
            {rupees(order.amount)}
            <Text style={{ color: c.textFaint }}>
              {'  '}(incl. shipping {shippingFee ? rupees(shippingFee) : 'Free'})
            </Text>
          </Text>
        </View>
        <View style={[styles.pill, { borderColor: pillColor }]}>
          <Text style={[styles.pillText, { color: pillColor }]}>{pillLabel}</Text>
        </View>
      </View>

      {/* Booked shipment detail */}
      {!!shipment?.awbCode && (
        <View style={[styles.awbRow, { borderTopColor: c.border }]}>
          <Text style={[styles.awbText, { color: c.textSecondary }]}>
            {shipment.courierName || 'Courier'} · AWB{' '}
            <Text style={{ color: c.text, fontFamily: Fonts.sansSemiBold }}>{shipment.awbCode}</Text>
          </Text>
          {!!shipment.labelUrl && (
            <Pressable
              onPress={() => WebBrowser.openBrowserAsync(shipment.labelUrl!).catch(() => {})}
              accessibilityRole="link"
              accessibilityLabel="Print shipping label"
              hitSlop={6}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[styles.labelLink, { color: c.primary }]}>Print label ↗</Text>
            </Pressable>
          )}
        </View>
      )}

      {!!tracking && <Text style={[styles.trackingText, { color: '#7CE0A8' }]}>{tracking}</Text>}
      {!!err && <Text style={[styles.cardError, { color: c.danger }]}>{err}</Text>}

      {/* Actions */}
      <View style={styles.actions}>
        {paid && !shipment?.awbCode && (
          <Pressable
            onPress={() => run('ship')}
            disabled={busy !== null || !pickupReady}
            accessibilityRole="button"
            accessibilityLabel={shipment ? 'Resume courier booking' : 'Ship this order'}
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: c.cta,
                opacity: pressed || busy !== null || !pickupReady ? 0.6 : 1,
              },
            ]}
          >
            {busy === 'ship' ? (
              <ActivityIndicator size="small" color={c.ctaText} />
            ) : (
              <Text style={[styles.actionText, { color: c.ctaText }]}>
                {shipment ? 'Resume booking' : 'Ship this order'}
              </Text>
            )}
          </Pressable>
        )}
        {!!shipment?.awbCode && shipment.status !== 'pickup_requested' && (
          <Pressable
            onPress={() => run('pickup')}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel="Request pickup"
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionGhost,
              { borderColor: c.borderStrong, opacity: pressed || busy !== null ? 0.6 : 1 },
            ]}
          >
            {busy === 'pickup' ? (
              <ActivityIndicator size="small" color={c.text} />
            ) : (
              <Text style={[styles.actionText, { color: c.text }]}>Request pickup</Text>
            )}
          </Pressable>
        )}
        {!!shipment?.awbCode && (
          <Pressable
            onPress={() => run('track')}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel="Track shipment"
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionGhost,
              { borderColor: c.border, opacity: pressed || busy !== null ? 0.6 : 1 },
            ]}
          >
            {busy === 'track' ? (
              <ActivityIndicator size="small" color={c.textSecondary} />
            ) : (
              <Text style={[styles.actionText, { color: c.textSecondary }]}>Track</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.sansSemiBold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two, paddingBottom: 90 },

  errorBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    backgroundColor: 'rgba(229,72,77,0.08)',
  },
  errorText: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },

  setupBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    backgroundColor: 'rgba(255,196,107,0.07)',
  },
  setupText: { flex: 1, fontSize: 13, fontFamily: Fonts.sansMedium, lineHeight: 18 },

  empty: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  emptyBody: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 20, textAlign: 'center', maxWidth: 300 },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  cardHead: { flexDirection: 'row', gap: Spacing.two },
  cardHeadText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 14.5, fontFamily: Fonts.sansSemiBold, lineHeight: 20 },
  cardMeta: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },
  pill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  pillText: { fontSize: 10.5, fontFamily: Fonts.sansSemiBold },

  awbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  awbText: { flex: 1, fontSize: 12.5, fontFamily: Fonts.sans },
  labelLink: { fontSize: 12.5, fontFamily: Fonts.sansSemiBold, paddingVertical: 4 },
  trackingText: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
  cardError: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  actionBtn: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three + Spacing.one,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionGhost: { backgroundColor: 'transparent', borderWidth: 1 },
  actionText: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
});
