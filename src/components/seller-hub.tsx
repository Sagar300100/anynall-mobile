// Seller Hub — the operational dashboard an APPROVED seller lands on.
//
// Section order follows the approved reference exactly: Today's Tasks,
// Upcoming Shows, Account Health, then the Payouts/Orders pair — nothing
// else. This screen owns its title bar and the Seller Tools button; sell.tsx
// hides its own top bar here, so there is exactly one header.
//
// HONESTY NOTES (these are why some cells show "—" rather than numbers):
//   • No revenue tile. analyticsRouter's sales figures are hardcoded zeros
//     until the payments backend lands; a "₹0 this week" tile would look
//     measured when nothing measures it.
//   • Account health shows "—". There is no scanRate/defectRate/policyStanding
//     model anywhere in this backend, so "Excellent" would be invented.
//   • Payout figures are summed from real orders (delivered = available,
//     in-flight = processing), so ₹0.00 here is measured, not hardcoded.
//     Seller payouts are manual today (paymentsRouter.js) — there is no
//     settlement endpoint to read a true ledger balance from.
//   • Orders counts real orders in a real rolling 7-day window.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, CardTitle, Note, TAB_BAR_CLEARANCE, TONE } from '@/components/step5-parts';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { type SellerOnboardingState } from '@/lib/seller';
import { getSellingOrders, type SellingOrder } from '@/lib/seller-hub';
import type { ShowData } from '@/lib/api';
import { deleteShow, fetchMyUpcomingShows } from '@/lib/shows';

const WEB_HUB = 'https://anynall.com';

/** No review SLA is claimed — we don't publish one, so we don't invent one. */
const STATUS_COPY: Record<string, { title: string; body: string; tone: 'ok' | 'warn' | 'bad' }> = {
  approved: {
    title: 'Selling is enabled',
    body: 'You can list products and host live shows.',
    tone: 'ok',
  },
  pending_review: {
    title: 'Application under review',
    body: 'Our compliance team is checking your application. We’ll email you when selling is enabled.',
    tone: 'warn',
  },
  action_required: {
    title: 'Action required',
    body: 'Our team has flagged something in your application. Check your email or contact seller support.',
    tone: 'bad',
  },
  rejected: {
    title: 'Selling not enabled',
    body: 'Your seller application wasn’t approved. Contact seller support for the reason.',
    tone: 'bad',
  },
};

/** Payout amounts always carry paise, so ₹0 reads as ₹0.00. formatPaise drops
 *  trailing zeros, which is right for prices but wrong for a balance. */
/** "Sun, 10 Aug · 8:00 pm" for a scheduled show. */
function formatShowWhen(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Rolling 7-day window in the device's timezone plus the real order count
 *  inside it. Called from an effect — React Compiler forbids new Date() in
 *  render. */
function last7Days(orders: SellingOrder[]): { label: string; count: number } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return {
    label: `${fmt(start)} – ${fmt(end)}`,
    count: orders.filter((o) => o.createdAtMs >= start.getTime()).length,
  };
}

export function SellerHub({
  state,
  onRefresh,
}: {
  state: SellerOnboardingState;
  onRefresh: () => void;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();

  const [orders, setOrders] = useState<SellingOrder[] | null>(null);
  const [shows, setShows] = useState<ShowData[] | null>(null);
  const [window7, setWindow7] = useState<{ label: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const fetchAll = useCallback(async () => {
    // Independent reads — one failing shouldn't blank the others, so each
    // settles on its own and an unavailable count renders as "—".
    const [o, s] = await Promise.allSettled([getSellingOrders(), fetchMyUpcomingShows()]);
    setOrders(o.status === 'fulfilled' ? o.value.orders : null);
    setShows(s.status === 'fulfilled' ? s.value : null);
    setWindow7(o.status === 'fulfilled' ? last7Days(o.value.orders) : null);
    setFailed([o, s].every((r) => r.status === 'rejected'));
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    await fetchAll();
    setBusy(false);
  }, [fetchAll]);

  // Refetch every time the tab regains focus. Tab screens stay mounted, so a
  // mount-only effect would never re-run — a show scheduled a moment ago
  // wouldn't appear until the app restarted.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [o, s] = await Promise.allSettled([getSellingOrders(), fetchMyUpcomingShows()]);
        if (cancelled) return;
        setOrders(o.status === 'fulfilled' ? o.value.orders : null);
        setShows(s.status === 'fulfilled' ? s.value : null);
        setWindow7(o.status === 'fulfilled' ? last7Days(o.value.orders) : null);
        setFailed([o, s].every((r) => r.status === 'rejected'));
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const status = STATUS_COPY[state.applicationStatus] ?? STATUS_COPY.pending_review;
  // "Selling enabled" comes from the server's application status, never from
  // local flags — a restricted seller must not see the green state.
  const approved = state.applicationStatus === 'approved';
  const hasShows = !!shows && shows.length > 0;

  function confirmCancel(id: string, name: string) {
    Alert.alert('Cancel this show?', `“${name}” will no longer be available to viewers.`, [
      { text: 'Keep Show', style: 'cancel' },
      {
        text: 'Cancel Show',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteShow(id);
            // Drop it locally so the list updates without a full refetch.
            setShows((prev) => prev?.filter((s) => String(s.id) !== id) ?? null);
          } catch {
            Alert.alert('Couldn’t cancel', 'Please check your connection and try again.');
          }
        },
      },
    ]);
  }
  const openWeb = () => WebBrowser.openBrowserAsync(WEB_HUB).catch(() => {});
  // Derived from real orders, so this is a measured ₹0.00 rather than a
  // hardcoded one. Delivered = settled; in-flight = still processing.
  const payable = {
    available: orders?.filter((o) => o.status === 'delivered').reduce((s, o) => s + o.amount, 0) ?? 0,
    processing:
      orders
        ?.filter((o) => ['paid', 'confirmed', 'shipped'].includes(o.status))
        .reduce((s, o) => s + o.amount, 0) ?? 0,
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={busy}
          onRefresh={() => {
            onRefresh();
            refresh();
          }}
          tintColor={c.textSecondary}
        />
      }
    >
      {/* ── Title + Seller Tools ── */}
      <View style={styles.titleBar}>
        <Text style={[styles.pageTitle, { color: c.text }]}>Seller Hub</Text>
        <Pressable
          onPress={() => router.push('/seller-tools')}
          accessibilityRole="button"
          accessibilityLabel="Seller Tools"
          hitSlop={8}
          style={({ pressed }) => [styles.toolsBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="menu" size={24} color={c.text} />
        </Pressable>
      </View>

      {!approved && (
        <Card tint={`${TONE[status.tone]}55`}>
          <View style={styles.statusHead}>
            <Ionicons
              name={status.tone === 'warn' ? 'time-outline' : 'alert-circle-outline'}
              size={20}
              color={TONE[status.tone]}
            />
            <Text style={[styles.statusTitle, { color: TONE[status.tone] }]}>{status.title}</Text>
          </View>
          <Text style={[styles.body, { color: c.textSecondary }]}>{status.body}</Text>
        </Card>
      )}

      {failed && (
        <Note tone="bad" icon="cloud-offline-outline">
          We couldn’t load your store activity. Pull down to retry.
        </Note>
      )}

      {/* ── Today's Tasks ── */}
      <Card>
        <CardTitle>Today’s Tasks</CardTitle>
        <TaskRow
          icon="videocam-outline"
          label="Schedule a Show"
          onPress={() => router.push('/show-new')}
        />
      </Card>

      {/* ── Upcoming Shows ── */}
      <Card>
        <HeaderRow
          title={hasShows ? 'Upcoming Shows' : 'No Upcoming Shows'}
          onPress={() => router.push('/show-new')}
        />
        {/* Real scheduled shows replace the empty-state card entirely. */}
        {hasShows &&
          shows!.map((s, i) => (
            <View key={String(s.id)}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
              <Pressable
                onPress={() => router.push(`/show-room/${s.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`${s.name}, ${s.scheduled_time ?? ''}, scheduled. Open show room`}
                style={({ pressed }) => [styles.showRow, pressed && { opacity: 0.7 }]}
              >
                {s.thumbnail ? (
                  <Image source={{ uri: s.thumbnail }} style={styles.showThumb} contentFit="cover" />
                ) : (
                  <View style={[styles.showThumb, styles.showThumbEmpty, { borderColor: c.border }]}>
                    <Ionicons name="videocam-outline" size={18} color={c.textFaint} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.orderTitle, { color: c.text }]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={[styles.orderMeta, { color: c.textSecondary }]} numberOfLines={1}>
                    {[formatShowWhen(s.scheduled_time), s.category].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={[styles.orderStatus, { color: TONE.ok }]}>Scheduled</Text>
                {/* Destructive, so it always confirms first. */}
                <Pressable
                  onPress={() => confirmCancel(String(s.id), s.name)}
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel ${s.name}`}
                  hitSlop={8}
                  style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="close" size={17} color={c.textFaint} />
                </Pressable>
              </Pressable>
            </View>
          ))}
        {/* Cobalt, not the reference's yellow — that is a competitor's colour.
            Hidden once real shows exist. */}
        {!hasShows && (
        <View style={styles.promo}>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={styles.promoTitle}>Always have a show scheduled</Text>
            <Text style={styles.promoBody}>
              Going live regularly builds your following, creates repeat buyers, and boosts sales.
            </Text>
            {/* Same destination as Today's Tasks — one scheduling flow. */}
            <Pressable
              onPress={() => router.push('/show-new')}
              accessibilityRole="button"
              accessibilityLabel="Get started scheduling a show"
              style={({ pressed }) => [styles.promoCta, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.promoCtaText}>Get Started</Text>
            </Pressable>
          </View>
          <Image
            source={require('../../assets/seller/show.png')}
            style={styles.promoArt}
            contentFit="contain"
            accessibilityIgnoresInvertColors
            accessible={false}
          />
        </View>
        )}
      </Card>

      {/* ── Account Health ── */}
      <Card>
        <HeaderRow title="Account Health" onPress={openWeb} />
        <View style={styles.health}>
          <HealthCell label={'On-Time\nScan Rate'} value={null} />
          <View style={[styles.healthDivider, { backgroundColor: c.border }]} />
          <HealthCell label={'Defect-Free\nOrder Rate'} value={null} />
          <View style={[styles.healthDivider, { backgroundColor: c.border }]} />
          {/* The reference reads "Excellent". There is no account-health model
              in this backend, so a standing would be invented — it stays "—"
              until one exists. */}
          <HealthCell label={'Policy\nStanding'} value={null} />
        </View>
      </Card>

      {/* ── Payouts + Orders ── */}
      <View style={styles.pair}>
        <Pressable
          onPress={openWeb}
          accessibilityRole="link"
          accessibilityLabel={`Payouts: ${formatRupees(payable.available)} available for payout`}
          style={({ pressed }) => [
            styles.pairCard,
            { backgroundColor: c.cardBackground, borderColor: c.border },
            pressed && { opacity: 0.75 },
          ]}
        >
          <View style={styles.pairHead}>
            <Text style={[styles.pairTitle, { color: c.text }]}>Payouts</Text>
            <Ionicons name="chevron-forward" size={15} color={c.textFaint} />
          </View>
          {/* Summed from real settled orders — genuinely ₹0.00 with none. */}
          <Text style={[styles.pairValue, { color: c.text }]}>
            {formatRupees(payable.available)}
          </Text>
          <Text style={[styles.pairMeta, { color: c.text }]}>Available for payout</Text>
          <Text style={[styles.small, { color: c.textFaint }]}>
            Processing {formatRupees(payable.processing)}
          </Text>
        </Pressable>

        <Pressable
          onPress={openWeb}
          accessibilityRole="link"
          accessibilityLabel={`Orders: ${window7?.count ?? 0} items, ${window7?.label ?? ''}`}
          style={({ pressed }) => [
            styles.pairCard,
            { backgroundColor: c.cardBackground, borderColor: c.border },
            pressed && { opacity: 0.75 },
          ]}
        >
          <View style={styles.pairHead}>
            <Text style={[styles.pairTitle, { color: c.text }]}>Orders</Text>
            <Ionicons name="chevron-forward" size={15} color={c.textFaint} />
          </View>
          <Text style={[styles.pairValue, { color: c.text }]}>
            {window7 ? `${window7.count} ${window7.count === 1 ? 'item' : 'items'}` : '—'}
          </Text>
          <Text style={[styles.pairMeta, { color: c.text }]}>{window7?.label ?? ''}</Text>
          <Text style={[styles.small, { color: c.textFaint }]}>Prior 7 days</Text>
        </Pressable>
      </View>

    </ScrollView>
  );
}

/** Card header with a chevron, matching the reference's tappable sections. */
function HeaderRow({ title, onPress }: { title: string; onPress: () => void }) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.headerRow, pressed && { opacity: 0.75 }]}
    >
      <Text style={[styles.headerRowTitle, { color: c.text }]}>{title}</Text>
      <Ionicons name="chevron-forward" size={17} color={c.textFaint} />
    </Pressable>
  );
}

function TaskRow({
  icon,
  label,
  onPress,
  external,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  external?: boolean;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.task, pressed && { opacity: 0.75 }]}
    >
      <View style={[styles.taskIcon, { backgroundColor: 'rgba(46,107,255,0.14)' }]}>
        <Ionicons name={icon} size={18} color={c.primary} />
      </View>
      <Text style={[styles.taskLabel, { color: c.text }]}>{label}</Text>
      <Ionicons name={external ? 'open-outline' : 'chevron-forward'} size={16} color={c.textFaint} />
    </Pressable>
  );
}

/** `null` renders an em dash. The metric exists in the design but has no data
 *  source in this backend, and inventing one would misrepresent the account.
 *  Labels carry an explicit newline so all three columns are the same height
 *  and the values sit on one baseline. */
function HealthCell({ label, value }: { label: string; value: string | null }) {
  const c = useBrandColors();
  return (
    <View
      style={styles.healthCell}
      accessible
      accessibilityLabel={`${label.replace('\n', ' ')}: ${value ?? 'no data yet'}`}
    >
      <Text style={[styles.healthLabel, { color: c.textSecondary }]}>{label}</Text>
      <Text style={[styles.healthValue, { color: value ? c.text : c.textFaint }]}>
        {value ?? '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },

  titleBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 40 },
  pageTitle: { flex: 1, fontSize: 26, fontFamily: Fonts.sansSemiBold },
  toolsBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: -8 },


  statusHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  statusTitle: { flex: 1, fontSize: 14.5, fontFamily: Fonts.sansSemiBold },


  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 26 },
  headerRowTitle: { flex: 1, fontSize: 16, fontFamily: Fonts.sansSemiBold },
  pairHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  task: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 42 },
  taskIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskLabel: { flex: 1, fontSize: 13.5, fontFamily: Fonts.sansMedium },

  promo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: '#2E6BFF',
    borderRadius: 14,
    padding: Spacing.two + Spacing.one,
  },
  promoTitle: { color: '#FFFFFF', fontSize: 14.5, fontFamily: Fonts.sansSemiBold, lineHeight: 19 },
  promoBody: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 11.5,
    fontFamily: Fonts.sans,
    lineHeight: 16,
  },
  promoCta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: Spacing.two + Spacing.one,
    minHeight: 36,
    marginTop: 3,
  },
  promoCtaText: { color: '#0B1B3A', fontSize: 12.5, fontFamily: Fonts.sansSemiBold },
  promoArt: { width: 82, height: 82 },

  health: { flexDirection: 'row', alignItems: 'flex-start' },
  healthCell: { flex: 1, gap: 6, paddingRight: Spacing.two },
  healthDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginRight: Spacing.two },
  healthLabel: { fontSize: 11, fontFamily: Fonts.sans, lineHeight: 15 },
  healthValue: { fontSize: 18, fontFamily: Fonts.sansSemiBold },

  pair: { flexDirection: 'row', gap: Spacing.two },
  pairCard: { flex: 1, borderWidth: 1, borderRadius: 14, padding: Spacing.two + Spacing.one, gap: 2 },
  pairTitle: { flex: 1, fontSize: 15, fontFamily: Fonts.sansSemiBold },
  pairValue: { fontSize: 19, fontFamily: Fonts.sansSemiBold, marginTop: 2 },
  pairMeta: { fontSize: 11, fontFamily: Fonts.sans, lineHeight: 15 },

  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  orderTitle: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
  orderMeta: { fontSize: 11.5, fontFamily: Fonts.sans },
  orderAmount: { fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  orderStatus: { fontSize: 11, fontFamily: Fonts.sansMedium },
  showRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 52 },
  showThumb: { width: 44, height: 58, borderRadius: 8 },
  showThumbEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', gap: 6, paddingVertical: Spacing.three },
  emptyTitle: { fontSize: 14, fontFamily: Fonts.sansSemiBold },

  body: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17.5 },
  small: { fontSize: 11, fontFamily: Fonts.sans, lineHeight: 15.5 },
});
