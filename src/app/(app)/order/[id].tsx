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
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/brand/eyebrow';
import { GlassCard } from '@/components/brand/glass-card';
import { GradientCTA } from '@/components/brand/gradient-cta';
import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { PayNowButton, orderAwaitingPayment } from '@/components/pay-now';
import { UnboxingRecorder } from '@/components/unboxing-recorder';
import { useBrandColors } from '@/components/ui/form';
import { Brand, CtaGradientShell, Fonts, Shadows, Spacing } from '@/constants/theme';
import { getMyOrder, listMyOrders, type BuyerOrder } from '@/lib/api';
import { humanizeStatus } from '@/lib/commerce';
import { getOrCreateDirectConversation } from '@/lib/conversations';
import { db } from '@/lib/firebase';
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_NOTE_MAX,
  complaintCategoryLabel,
  fileComplaint,
  isEndpointMissing,
  protectionErrorMessage,
  type ComplaintCategory,
  type OrderDispute,
} from '@/lib/protection';
import { msUntil } from '@/lib/server-time';
import { trackOrder, SHIP_STAGE, type TrackingInfo } from '@/lib/shipping';
import { latestUnboxingPath } from '@/lib/unboxing';

function rupees(paise: number) {
  return `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Success green — same as the recorder's saved state and other check marks. */
const SUCCESS = '#34D399';
const WARN = '#FFC46B';

/** ms → "23h 59m" / "42m 10s" / "35s" for the complaint-window countdown. */
function formatWindowLeft(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
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

  // ── Buyer protection (spec Gap 2) ──
  // The saved unboxing video's Storage path. Seeded from the dispute doc when
  // one exists, or from a metadata probe of the canonical path (the buyer may
  // have recorded on an earlier visit — the order docs don't carry the path
  // pre-complaint, only local state does).
  const [savedVideoPath, setSavedVideoPath] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  // Bumped after a Pay-now success so the effect refetches the paid order.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      // The list is the fast path (one request also warms the Orders screen);
      // an order outside its first page — an old deep link, a push target on
      // a busy account — falls back to the per-order GET, the authority.
      try {
        const orders = await listMyOrders();
        if (cancelled) return;
        let found = orders.find((o) => o.id === String(id)) || null;
        if (!found) {
          try {
            found = await getMyOrder(String(id));
          } catch (e) {
            // Only the direct fetch's 404 means "not on this account" (or the
            // route hasn't deployed — same honest floor). Anything else is a
            // load failure, not proof the order doesn't exist.
            if (!isEndpointMissing(e)) throw e;
            found = null;
          }
        }
        if (cancelled) return;
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
  }, [id, refreshKey]);

  /** Pay-now succeeded (server-verified): flip the local status immediately
   *  so the window closes on screen, then refetch for the real stamps. */
  const handlePaid = useCallback(() => {
    setOrder((prev) => (prev ? { ...prev, status: 'paid' } : prev));
    setRefreshKey((k) => k + 1);
  }, []);

  // Seed the recorder with an already-uploaded take. Recordings are
  // CREATE-ONLY with timestamped names (evidence can't be overwritten once a
  // seller may be reviewing it), so the probe LISTS the order's folder and
  // takes the newest. Every failure (no video yet, Storage rules not
  // deployed) leaves the recorder idle — never an error, the buyer just
  // records fresh. A dispute doc's own videoPath needs no probe: it's
  // DERIVED at render, never synced here.
  useEffect(() => {
    if (!order || order.protection?.status !== 'in_window' || order.dispute?.videoPath) return;
    let cancelled = false;
    latestUnboxingPath(order.id)
      .then((path) => {
        if (!cancelled && path) setSavedVideoPath((p) => p || path);
      })
      .catch(() => {
        /* no saved video — the recorder starts idle */
      });
    return () => {
      cancelled = true;
    };
  }, [order]);

  const handleVideoSaved = useCallback((path: string) => {
    setSavedVideoPath(path);
  }, []);

  const openReport = useCallback(() => setReportOpen(true), []);
  const closeReport = useCallback(() => setReportOpen(false), []);

  /** Complaint landed server-side — mirror it onto the local order so the
   *  screen flips to the disputed state without a refetch. */
  const handleFiled = useCallback((dispute: OrderDispute) => {
    setReportOpen(false);
    setOrder((prev) =>
      prev
        ? {
            ...prev,
            protection: { ...(prev.protection || {}), status: 'disputed' },
            dispute,
          }
        : prev
    );
  }, []);

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

  // Buyer protection: render the section only for states the order genuinely
  // carries. `in_window` additionally requires the delivered stamp — the
  // window doesn't exist before delivery.
  const protectionStatus = order?.protection?.status || null;
  const showProtection =
    !!protectionStatus && (protectionStatus !== 'in_window' || !!order?.deliveredAt);
  // Derived, never synced via an effect: a filed dispute already names the
  // video, and this mount's own recording (savedVideoPath) wins over it.
  const videoPath = savedVideoPath || order?.dispute?.videoPath || null;

  return (
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <PressScale
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/orders'))}
          accessibilityRole="button"
          accessibilityLabel="Back to orders"
          hitSlop={10}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </PressScale>
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
          <View style={styles.card}>
            <Text style={[styles.productTitle, { color: c.text }]}>{order.productTitle}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.amount}>
                {order.purchaseType === 'giveaway' && !(order.amount > 0)
                  ? 'Giveaway — free'
                  : rupees(order.amount)}
              </Text>
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

          {/* ── Pay now (Gap 8): an order created FOR this buyer — an accepted
                 offer, or a buy-now whose checkout was dismissed — still owes
                 payment. Countdown + checkout live in PayNowButton. */}
          {orderAwaitingPayment(order) && (
            <>
              <Eyebrow style={styles.sectionLabel}>Complete your payment</Eyebrow>
              <View
                style={styles.card}
              >
                <Text style={[styles.body, { color: c.textSecondary }]}>
                  One unit is reserved for you. Pay before the window ends or the reservation is
                  released.
                </Text>
                <PayNowButton order={order} onPaid={handlePaid} />
              </View>
            </>
          )}

          {/* ── Shipment ── */}
          <Eyebrow style={styles.sectionLabel}>Delivery</Eyebrow>
          <View style={styles.card}>
            {!shipment?.awbCode ? (
              order.needsAddress === true ? (
                // The order exists without a delivery address (giveaway win,
                // offer accepted before one was saved) — v1: save the profile
                // address, the seller collects it from there.
                <PressScale
                  onPress={() => router.push('/account/address')}
                  accessibilityRole="button"
                  accessibilityLabel="Add your delivery address so the seller can ship"
                  style={styles.emptyShip}
                >
                  <Ionicons name="location-outline" size={22} color={c.primary} />
                  <Text style={[styles.body, { color: c.textSecondary, flex: 1 }]}>
                    Add your delivery address so the seller can ship.
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                </PressScale>
              ) : (
                <View style={styles.emptyShip}>
                  <Ionicons name="cube-outline" size={22} color={c.textFaint} />
                  <Text style={[styles.body, { color: c.textSecondary }]}>
                    {order.status === 'paid' || order.status === 'confirmed'
                      ? 'The seller hasn’t shipped this yet — tracking appears here the moment a courier is booked.'
                      : 'No shipment on this order.'}
                  </Text>
                </View>
              )
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
                      <PressScale
                        onPress={() => WebBrowser.openBrowserAsync(tracking.trackUrl!).catch(() => {})}
                        accessibilityRole="link"
                        accessibilityLabel="Open the courier's tracking page"
                        style={[styles.trackBtn, { borderColor: Brand.hairline }]}
                      >
                        <Ionicons name="open-outline" size={14} color={c.primary} />
                        <Text style={[styles.trackBtnText, { color: c.primary }]}>
                          Open courier tracking ↗
                        </Text>
                      </PressScale>
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

          {/* ── Buyer protection (spec Gap 2) ── */}
          {showProtection && order && (
            <>
              <Eyebrow style={styles.sectionLabel}>Buyer protection</Eyebrow>

              {protectionStatus === 'in_window' ? (
                <ProtectionWindow order={order} onReport={openReport}>
                  <UnboxingRecorder
                    orderId={order.id}
                    existingPath={videoPath}
                    onSaved={handleVideoSaved}
                  />
                </ProtectionWindow>
              ) : protectionStatus === 'disputed' ? (
                <View
                  style={styles.card}
                >
                  <View style={styles.protTitleRow}>
                    <Ionicons name="alert-circle" size={18} color={WARN} />
                    <Text style={[styles.protTitle, { color: c.text }]}>
                      Report filed — {complaintCategoryLabel(order.dispute?.category)}
                    </Text>
                  </View>
                  {!!order.dispute?.note && (
                    <Text style={[styles.body, { color: c.textSecondary }]}>
                      “{order.dispute.note}”
                    </Text>
                  )}
                  {!!order.dispute?.filedAt && (
                    <Text style={[styles.meta, { color: c.textFaint }]}>
                      Filed {shortDate(order.dispute.filedAt)}
                      {order.dispute?.videoPath ? '  ·  Unboxing video attached' : ''}
                    </Text>
                  )}
                  <Text style={[styles.body, { color: c.textSecondary }]}>
                    The seller and Any&All are reviewing — your payment stays held.
                  </Text>
                </View>
              ) : protectionStatus === 'released' ? (
                <View
                  style={styles.card}
                >
                  <View style={styles.protTitleRow}>
                    <Ionicons name="shield-checkmark" size={18} color={SUCCESS} />
                    <Text style={[styles.protTitle, { color: c.text }]}>
                      Payment released to the seller
                      {order.protection?.releasedAt
                        ? ` on ${shortDate(order.protection.releasedAt)}`
                        : order.complaintWindowEndsAt
                          ? ` on ${shortDate(order.complaintWindowEndsAt)}`
                          : ''}
                    </Text>
                  </View>
                  <Text style={[styles.body, { color: c.textSecondary }]}>
                    Your payment was held by Any&All until 24 hours after delivery. No complaint
                    was filed in that window, so it was released to the seller.
                  </Text>
                </View>
              ) : protectionStatus === 'refunded_pending' ? (
                <View
                  style={styles.card}
                >
                  <View style={styles.protTitleRow}>
                    <Ionicons name="return-down-back" size={18} color={SUCCESS} />
                    <Text style={[styles.protTitle, { color: c.text }]}>Refund on its way</Text>
                  </View>
                  <Text style={[styles.body, { color: c.textSecondary }]}>
                    Your report was accepted. The refund goes back to the payment method you paid
                    with — reach out to support if it hasn’t landed in a few days.
                  </Text>
                </View>
              ) : null}
            </>
          )}

          {/* ── Help ── */}
          <Eyebrow style={styles.sectionLabel}>Need help?</Eyebrow>
          <View style={styles.actions}>
            {!!order.showId && (
              <PressScale
                onPress={messageSeller}
                disabled={messaging}
                accessibilityRole="button"
                accessibilityLabel="Message the seller about this order"
                style={[styles.actionBtn, Shadows.cta, messaging && { opacity: 0.75 }]}
              >
                <LinearGradient
                  colors={[...CtaGradientShell]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.actionFill}
                >
                  {messaging ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="chatbubble-outline" size={15} color="#FFFFFF" />
                      <Text style={[styles.actionText, { color: '#FFFFFF' }]}>Message seller</Text>
                    </>
                  )}
                </LinearGradient>
              </PressScale>
            )}
            <PressScale
              onPress={() => router.push('/support-chat')}
              accessibilityRole="button"
              accessibilityLabel="Get help from support"
              style={[styles.actionBtn, styles.actionGhost, { borderColor: Brand.hairline }]}
            >
              <Text style={[styles.actionText, { color: c.text }]}>Get support</Text>
            </PressScale>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
        </View>
      )}

      {order && (
        <ReportProblemSheet
          visible={reportOpen}
          orderId={order.id}
          videoPath={videoPath}
          onClose={closeReport}
          onFiled={handleFiled}
        />
      )}
      </SafeAreaView>
    </View>
  );
}

/** The live 24h window: countdown card + honest held-payment copy, the
 *  recorder (children), then the report entry — in that order, so the video
 *  step sits between reading about the window and filing. Owns its own 1s
 *  tick against the SERVER clock (msUntil), the same idiom as the auction
 *  countdown, so every device shows the same deadline. */
function ProtectionWindow({
  order,
  onReport,
  children,
}: {
  order: BuyerOrder;
  onReport: () => void;
  children: ReactNode;
}) {
  const c = useBrandColors();
  const endsAt = order.complaintWindowEndsAt || null;
  const [msLeft, setMsLeft] = useState(() => msUntil(endsAt));
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setMsLeft(msUntil(endsAt));
    tick();
    const idInterval = setInterval(tick, 1000);
    return () => clearInterval(idInterval);
  }, [endsAt]);
  // No deadline on the doc yet → the window is open as far as we know; the
  // server re-checks on file anyway.
  const windowOpen = endsAt ? msLeft > 0 : true;

  return (
    <>
      <GlassCard variant="panel" style={styles.cardInner}>
        <View style={styles.protTitleRow}>
          <Ionicons name="shield-checkmark-outline" size={18} color={SUCCESS} />
          <Text style={[styles.protTitle, { color: c.text }]}>Payment protection</Text>
          {!!endsAt && windowOpen && (
            <View style={[styles.pill, { borderColor: 'rgba(52,211,153,0.5)' }]}>
              <Text style={[styles.pillText, { color: SUCCESS }]}>
                {formatWindowLeft(msLeft)} left
              </Text>
            </View>
          )}
        </View>
        <Text style={[styles.body, { color: c.textSecondary }]}>
          Your payment is held by Any&All until 24 hours after delivery. No complaint in that
          window releases it to the seller.
        </Text>
        {!!order.deliveredAt && (
          <Text style={[styles.meta, { color: c.textFaint }]}>
            Delivered {shortDate(order.deliveredAt)}
          </Text>
        )}
      </GlassCard>

      {children}

      {windowOpen ? (
        <PressScale
          onPress={onReport}
          accessibilityRole="button"
          accessibilityLabel="Report a problem with this order"
          style={[styles.reportBtn, { borderColor: 'rgba(248,113,113,0.45)' }]}
        >
          <Ionicons name="flag-outline" size={15} color={c.danger} />
          <Text style={[styles.reportBtnText, { color: c.danger }]}>Report a problem</Text>
        </PressScale>
      ) : (
        <Text style={[styles.hint, { color: c.textFaint }]}>
          The 24-hour report window has closed — your payment is being released to the seller.
        </Text>
      )}
    </>
  );
}

/** "Report a problem" sheet: the spec's five categories, an optional note,
 *  and a HARD gate on the saved unboxing video — the complaint endpoint
 *  rejects a filing without one, so the sheet explains instead of failing. */
function ReportProblemSheet({
  visible,
  orderId,
  videoPath,
  onClose,
  onFiled,
}: {
  visible: boolean;
  orderId: string;
  /** Saved unboxing-video Storage path — REQUIRED to submit. */
  videoPath: string | null;
  onClose: () => void;
  onFiled: (dispute: OrderDispute) => void;
}) {
  const c = useBrandColors();
  const [category, setCategory] = useState<ComplaintCategory | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!category || !videoPath || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await fileComplaint(orderId, { category, note: note.trim(), videoPath });
      onFiled({
        category,
        note: note.trim() || null,
        videoPath,
        filedAt: new Date().toISOString(),
      });
    } catch (e) {
      setErr(
        isEndpointMissing(e)
          ? 'Problem reports aren’t available yet — this protection feature is still rolling out. Contact support and we’ll handle it directly.'
          : protectionErrorMessage(e, 'Couldn’t file your report — please try again.')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetScrim}>
        <View
          style={[styles.sheet, { backgroundColor: Brand.ink800, borderColor: Brand.hairline }]}
        >
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetTitle, { color: c.text }]}>Report a problem</Text>
            <PressScale
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close the report form"
            >
              <Ionicons name="close" size={20} color={c.textSecondary} />
            </PressScale>
          </View>

          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollInner}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.hint, { color: c.textSecondary }]}>
              What went wrong with this order?
            </Text>

            {COMPLAINT_CATEGORIES.map((cat) => {
              const selected = category === cat.value;
              return (
                <PressScale
                  key={cat.value}
                  onPress={() => setCategory(cat.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={cat.label}
                  style={[
                    styles.catRow,
                    {
                      borderColor: selected ? c.primary : Brand.hairlineWhite,
                      backgroundColor: selected ? 'rgba(77,184,255,0.08)' : 'transparent',
                    },
                  ]}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={19}
                    color={selected ? c.primary : c.textFaint}
                  />
                  <View style={styles.catText}>
                    <Text style={[styles.catLabel, { color: c.text }]}>{cat.label}</Text>
                    <Text style={[styles.catHint, { color: c.textFaint }]}>{cat.hint}</Text>
                  </View>
                </PressScale>
              );
            })}

            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add details (optional)"
              placeholderTextColor={c.textFaint}
              multiline
              maxLength={COMPLAINT_NOTE_MAX}
              accessibilityLabel="Details about the problem"
              style={[
                styles.noteInput,
                { color: c.text, borderColor: Brand.hairlineWhite, backgroundColor: 'rgba(255,255,255,0.05)' },
              ]}
            />

            {/* The video gate — honest about WHY it's required. */}
            {videoPath ? (
              <View style={[styles.videoState, { borderColor: 'rgba(52,211,153,0.4)' }]}>
                <Ionicons name="videocam" size={16} color={SUCCESS} />
                <Text style={[styles.videoStateText, { color: c.textSecondary }]}>
                  Unboxing video attached — it’s the evidence backing your report.
                </Text>
              </View>
            ) : (
              <View style={[styles.videoState, { borderColor: 'rgba(255,196,107,0.4)' }]}>
                <Ionicons name="videocam-off-outline" size={16} color={WARN} />
                <Text style={[styles.videoStateText, { color: c.textSecondary }]}>
                  A saved unboxing video is required — it’s what lets Any&All verify the problem
                  instead of taking anyone’s word for it. Close this and record one first.
                </Text>
              </View>
            )}

            {!!err && <Text style={[styles.errorText, { color: c.danger }]}>{err}</Text>}

            <GradientCTA
              title={busy ? 'Submitting…' : 'Submit report'}
              onPress={submit}
              disabled={busy || !category || !videoPath}
            />
            <Text style={[styles.hint, { color: c.textFaint }]}>
              Filing a report holds your payment until it’s resolved. You can file one report per
              order, inside 24 hours of delivery.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
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
  topTitle: { flex: 1, fontSize: 20, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  body: { fontSize: 14, fontFamily: Fonts.ui, lineHeight: 21 },
  hint: { fontSize: 12, fontFamily: Fonts.ui, lineHeight: 17 },
  errorText: { fontSize: 13, fontFamily: Fonts.ui, lineHeight: 19 },
  sectionLabel: { marginLeft: 4, marginBottom: -Spacing.one },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two + Spacing.one, paddingBottom: 90 },
  card: {
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: Spacing.three + Spacing.one,
    gap: Spacing.two,
  },
  // Inner layout for GlassCard panels (the card paints itself).
  cardInner: { padding: Spacing.three + Spacing.one, gap: Spacing.two },

  productTitle: { fontSize: 16.5, fontFamily: Fonts.uiSemiBold, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  amount: { flex: 1, fontSize: 18, fontFamily: Fonts.uiExtraBold, color: Brand.blueSky },
  meta: { fontSize: 13, fontFamily: Fonts.ui, lineHeight: 19 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 11, fontFamily: Fonts.uiSemiBold },

  emptyShip: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  awbRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actionFill: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 13,
    minHeight: 46,
    overflow: 'hidden',
  },
  courier: { flex: 1, fontSize: 14.5, fontFamily: Fonts.uiSemiBold },
  awb: { fontFamily: Fonts.mono, fontSize: 13.5 },
  trackLoading: { paddingVertical: Spacing.two },

  statusBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: Spacing.two + Spacing.one,
    backgroundColor: 'rgba(124,224,168,0.07)',
  },
  statusNow: { fontSize: 13, fontFamily: Fonts.uiSemiBold, lineHeight: 18 },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    borderWidth: 1,
    borderRadius: 13,
    minHeight: 42,
  },
  trackBtnText: { fontSize: 13, fontFamily: Fonts.uiSemiBold },

  timeline: { marginTop: Spacing.one },
  timelineRow: { flexDirection: 'row', gap: Spacing.two + Spacing.one },
  timelineRail: { alignItems: 'center', width: 12 },
  timelineDot: { width: 9, height: 9, borderRadius: 5, marginTop: 4 },
  timelineLine: { flex: 1, width: 2, marginVertical: 2 },
  timelineText: { flex: 1, paddingBottom: Spacing.three, gap: 1 },
  timelineActivity: { fontSize: 13.5, fontFamily: Fonts.uiSemiBold, lineHeight: 19 },
  timelineMeta: { fontSize: 11.5, fontFamily: Fonts.ui },

  actions: { flexDirection: 'row', gap: Spacing.two },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 13,
    minHeight: 46,
  },
  actionGhost: { backgroundColor: 'transparent', borderWidth: 1 },
  actionText: { fontSize: 13.5, fontFamily: Fonts.uiBold },

  // ── Buyer protection ──
  protTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  protTitle: { flex: 1, fontSize: 15, fontFamily: Fonts.uiSemiBold, lineHeight: 20 },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 13,
    minHeight: 46,
  },
  reportBtnText: { fontSize: 13.5, fontFamily: Fonts.uiBold },

  // ── Report-a-problem sheet ──
  sheetScrim: {
    flex: 1,
    backgroundColor: 'rgba(2,6,16,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  sheetScroll: { maxHeight: 520 },
  sheetScrollInner: { gap: Spacing.two },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  catText: { flex: 1, gap: 1 },
  catLabel: { fontSize: 14, fontFamily: Fonts.uiSemiBold },
  catHint: { fontSize: 12, fontFamily: Fonts.ui, lineHeight: 16 },
  noteInput: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 74,
    padding: Spacing.three,
    fontSize: 14,
    fontFamily: Fonts.ui,
    textAlignVertical: 'top',
  },
  videoState: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 10,
    padding: Spacing.two + Spacing.one,
  },
  videoStateText: { flex: 1, fontSize: 12.5, fontFamily: Fonts.ui, lineHeight: 18 },
});
