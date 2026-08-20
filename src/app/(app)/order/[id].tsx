// Buyer order detail — the tracking experience the parity audit called out
// as missing ("one text line only; order cards aren't tappable").
//
// GET /api/shipping/orders/:id/track already authorises the BUYER (the order's
// seller and buyer only — a tracking URL leaks a delivery address to whoever
// holds it, so nobody else). This screen turns that into: courier + AWB
// (selectable for copy), the live status with ETA, the courier's own tracking
// page, the full activity timeline, and a jump into chat with the seller.
import Ionicons from '@expo/vector-icons/Ionicons';
import { doc, getDoc } from 'firebase/firestore';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { listMyOrders, type BuyerOrder } from '@/lib/api';
import { humanizeStatus } from '@/lib/commerce';
import { getOrCreateDirectConversation } from '@/lib/conversations';
import { db } from '@/lib/firebase';
import { trackOrder, SHIP_STAGE, type TrackingInfo } from '@/lib/shipping';

function rupees(paise: number) {
  return `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Mirrors lib/seller-hub's ORDER_STATUS vocabulary — pending_payment → paid
 *  is the real lifecycle, with payment_expired / payment_failed /
 *  late_success_review as the non-paid outcomes the backend writes. */
const ORDER_STATUS_LABEL: Record<string, string> = {
  paid: 'Paid',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  pending: 'Awaiting payment',
  created: 'Awaiting payment',
  pending_payment: 'Awaiting payment',
  late_success_review: 'Under review',
  payment_expired: 'Payment expired',
  payment_failed: 'Payment failed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  failed: 'Payment failed',
};

export default function BuyerOrderDetailScreen() {
  const c = useBrandColors();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [order, setOrder] = useState<BuyerOrder | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tracking, setTracking] = useState<TrackingInfo | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      // No per-order buyer endpoint exists — refetch the list and pick the
      // order out, so a cold deep-link works too.
      try {
        const orders = await listMyOrders();
        if (cancelled) return;
        const found = orders.find((o) => o.id === String(id)) || null;
        setOrder(found);
        setNotFound(!found);
        // Auto-load tracking when a courier is booked.
        if (found?.shipment?.awbCode) {
          setLoadingTrack(true);
          try {
            const t = await trackOrder(found.id);
            if (!cancelled) setTracking(t.tracking);
          } catch {
            if (!cancelled) setTrackError('Couldn’t fetch tracking right now — pull back and retry.');
          } finally {
            if (!cancelled) setLoadingTrack(false);
          }
        }
      } catch {
        if (!cancelled) setError('Couldn’t load this order. Check your connection and try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function messageSeller() {
    if (!order?.showId || messaging) return;
    setMessaging(true);
    try {
      // The buyer order carries the showId; the show doc carries the seller.
      const snap = await getDoc(doc(db, 'shows', String(order.showId)));
      const ownerUid = snap.exists() ? (snap.data() as any)?.ownerUid : null;
      const sellerName = snap.exists()
        ? (snap.data() as any)?.sellerUsername || (snap.data() as any)?.seller || 'Seller'
        : 'Seller';
      if (!ownerUid) {
        setError('Couldn’t find this order’s seller.');
        return;
      }
      const convId = await getOrCreateDirectConversation(ownerUid, { displayName: sellerName });
      router.push({
        pathname: '/chat/[id]',
        params: { id: convId, otherUid: ownerUid, otherName: sellerName },
      });
    } catch {
      setError('Couldn’t open the conversation — please try again.');
    } finally {
      setMessaging(false);
    }
  }

  const shipment = order?.shipment;
  const stage = shipment?.status ? SHIP_STAGE[shipment.status] || shipment.status : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/orders'))}
          accessibilityRole="button"
          accessibilityLabel="Back to orders"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Order details</Text>
      </View>

      {!order && !notFound && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : notFound ? (
        <View style={styles.center}>
          <Ionicons name="receipt-outline" size={36} color={c.textFaint} />
          <Text style={[styles.body, { color: c.textSecondary }]}>
            This order isn’t on your account.
          </Text>
        </View>
      ) : order ? (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {!!error && <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>}

          {/* ── Order summary ── */}
          <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            <Text style={[styles.productTitle, { color: c.text }]}>{order.productTitle}</Text>
            <View style={styles.metaRow}>
              <Text style={[styles.amount, { color: c.text }]}>{rupees(order.amount)}</Text>
              <View style={[styles.pill, { borderColor: c.primary }]}>
                <Text style={[styles.pillText, { color: c.primary }]}>
                  {ORDER_STATUS_LABEL[order.status] || humanizeStatus(order.status)}
                </Text>
              </View>
            </View>
            {!!order.createdAt && (
              <Text style={[styles.meta, { color: c.textFaint }]}>
                Ordered{' '}
                {new Date(order.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                {'  ·  '}#{order.id.slice(0, 12)}
              </Text>
            )}
          </View>

          {/* ── Shipment ── */}
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>DELIVERY</Text>
          <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            {!shipment?.awbCode ? (
              <View style={styles.emptyShip}>
                <Ionicons name="cube-outline" size={22} color={c.textFaint} />
                <Text style={[styles.body, { color: c.textSecondary }]}>
                  {order.status === 'paid' || order.status === 'confirmed'
                    ? 'The seller hasn’t shipped this yet — tracking appears here the moment a courier is booked.'
                    : 'No shipment on this order.'}
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.awbRow}>
                  <Ionicons name="cube-outline" size={17} color={c.primary} />
                  <Text style={[styles.courier, { color: c.text }]}>
                    {shipment.courierName || 'Courier'}
                  </Text>
                  {!!stage && (
                    <View style={[styles.pill, { borderColor: 'rgba(124,224,168,0.5)' }]}>
                      <Text style={[styles.pillText, { color: '#7CE0A8' }]}>{stage}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.meta, { color: c.textSecondary }]}>
                  AWB{'  '}
                  <Text selectable style={[styles.awb, { color: c.text }]}>
                    {shipment.awbCode}
                  </Text>
                </Text>
                <Text style={[styles.hint, { color: c.textFaint }]}>
                  Long-press the AWB number to copy it.
                </Text>

                {loadingTrack ? (
                  <ActivityIndicator color={c.primary} style={styles.trackLoading} />
                ) : trackError ? (
                  <Text style={[styles.errorText, { color: c.danger }]}>{trackError}</Text>
                ) : tracking ? (
                  <>
                    {!!tracking.status && (
                      <View style={[styles.statusBox, { borderColor: 'rgba(124,224,168,0.35)' }]}>
                        <Text style={[styles.statusNow, { color: '#7CE0A8' }]}>
                          {tracking.status}
                          {tracking.etd ? `  ·  ETA ${tracking.etd}` : ''}
                          {tracking.deliveredDate ? `  ·  Delivered ${tracking.deliveredDate}` : ''}
                        </Text>
                      </View>
                    )}
                    {!!tracking.trackUrl && (
                      <Pressable
                        onPress={() => WebBrowser.openBrowserAsync(tracking.trackUrl!).catch(() => {})}
                        accessibilityRole="link"
                        accessibilityLabel="Open the courier's tracking page"
                        style={({ pressed }) => [
                          styles.trackBtn,
                          { borderColor: c.borderStrong, opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <Ionicons name="open-outline" size={14} color={c.primary} />
                        <Text style={[styles.trackBtnText, { color: c.primary }]}>
                          Open courier tracking ↗
                        </Text>
                      </Pressable>
                    )}

                    {/* ── Timeline ── */}
                    {tracking.activities.length > 0 && (
                      <View style={styles.timeline}>
                        {tracking.activities.map((a, i) => (
                          <View key={`${a.date}-${i}`} style={styles.timelineRow}>
                            <View style={styles.timelineRail}>
                              <View
                                style={[
                                  styles.timelineDot,
                                  { backgroundColor: i === 0 ? c.primary : 'rgba(120,150,210,0.35)' },
                                ]}
                              />
                              {i < tracking.activities.length - 1 && (
                                <View style={[styles.timelineLine, { backgroundColor: c.border }]} />
                              )}
                            </View>
                            <View style={styles.timelineText}>
                              <Text
                                style={[
                                  styles.timelineActivity,
                                  { color: i === 0 ? c.text : c.textSecondary },
                                ]}
                              >
                                {a.activity || a.status}
                              </Text>
                              <Text style={[styles.timelineMeta, { color: c.textFaint }]}>
                                {[a.location, a.date].filter(Boolean).join('  ·  ')}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                ) : (
                  <Text style={[styles.hint, { color: c.textFaint }]}>No tracking updates yet.</Text>
                )}
              </>
            )}
          </View>

          {/* ── Help ── */}
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>NEED HELP?</Text>
          <View style={styles.actions}>
            {!!order.showId && (
              <Pressable
                onPress={messageSeller}
                disabled={messaging}
                accessibilityRole="button"
                accessibilityLabel="Message the seller about this order"
                style={({ pressed }) => [
                  styles.actionBtn,
                  { backgroundColor: c.cta, opacity: pressed || messaging ? 0.75 : 1 },
                ]}
              >
                {messaging ? (
                  <ActivityIndicator size="small" color={c.ctaText} />
                ) : (
                  <>
                    <Ionicons name="chatbubble-outline" size={15} color={c.ctaText} />
                    <Text style={[styles.actionText, { color: c.ctaText }]}>Message seller</Text>
                  </>
                )}
              </Pressable>
            )}
            <Pressable
              onPress={() => router.push('/support-chat')}
              accessibilityRole="button"
              accessibilityLabel="Get help from support"
              style={({ pressed }) => [
                styles.actionBtn,
                styles.actionGhost,
                { borderColor: c.borderStrong, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Text style={[styles.actionText, { color: c.text }]}>Get support</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
        </View>
      )}
    </SafeAreaView>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  body: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 21 },
  hint: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 17 },
  errorText: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },
  sectionLabel: { fontSize: 11.5, fontFamily: Fonts.sansMedium, letterSpacing: 1.1, marginLeft: 4, marginBottom: -Spacing.one },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two + Spacing.one, paddingBottom: 90 },
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three + Spacing.one, gap: Spacing.two },

  productTitle: { fontSize: 16.5, fontFamily: Fonts.sansSemiBold, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  amount: { flex: 1, fontSize: 18, fontFamily: Fonts.sansSemiBold },
  meta: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 11, fontFamily: Fonts.sansSemiBold },

  emptyShip: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  awbRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  courier: { flex: 1, fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  awb: { fontFamily: Fonts.mono, fontSize: 13.5 },
  trackLoading: { paddingVertical: Spacing.two },

  statusBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: Spacing.two + Spacing.one,
    backgroundColor: 'rgba(124,224,168,0.07)',
  },
  statusNow: { fontSize: 13, fontFamily: Fonts.sansMedium, lineHeight: 18 },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 42,
  },
  trackBtnText: { fontSize: 13, fontFamily: Fonts.sansMedium },

  timeline: { marginTop: Spacing.one },
  timelineRow: { flexDirection: 'row', gap: Spacing.two + Spacing.one },
  timelineRail: { alignItems: 'center', width: 12 },
  timelineDot: { width: 9, height: 9, borderRadius: 5, marginTop: 4 },
  timelineLine: { flex: 1, width: 2, marginVertical: 2 },
  timelineText: { flex: 1, paddingBottom: Spacing.three, gap: 1 },
  timelineActivity: { fontSize: 13.5, fontFamily: Fonts.sansMedium, lineHeight: 19 },
  timelineMeta: { fontSize: 11.5, fontFamily: Fonts.sans },

  actions: { flexDirection: 'row', gap: Spacing.two },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    minHeight: 46,
  },
  actionGhost: { backgroundColor: 'transparent', borderWidth: 1 },
  actionText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
});
