// Seller analytics — mobile port of the website's sellerhub AnalyticsPanel
// against GET /api/analytics/dashboard. Replaces the Seller Tools stub.
//
// REAL DATA ONLY, same rule as both the backend and the web panel: the server
// returns genuine zeros for sales until the payments ledger feeds it, and
// this screen renders honest empty states over the zero chart — never fake
// numbers. "Shows created" is the one live measurement today; the rest starts
// counting from the seller's first order.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
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
import { fetchAnalyticsDashboard, type AnalyticsDashboard } from '@/lib/seller-hub';

export default function SellerAnalyticsScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchAnalyticsDashboard('7d'));
      setError(null);
    } catch {
      setError('Couldn’t load analytics. Check your connection and try again.');
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

  const bars = data?.revenueBars || [];
  const hasRevenue = bars.some((b) => b.value > 0);
  const maxVal = Math.max(...bars.map((b) => b.value), 1);

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
        <Text style={[styles.topTitle, { color: c.text }]}>Seller analytics</Text>
        <Text style={[styles.range, { color: c.textFaint }]}>Last 7 days</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="bar-chart-outline"
          title="Sign in to see your analytics"
          body="Sales, orders and show metrics for your store live here."
          reason="sell"
        />
      ) : data === null && !error ? (
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

          <Text style={[styles.note, { color: c.textSecondary }]}>
            Live data from your store — sales metrics start counting from your first order.
          </Text>

          {/* ── Stat cards ── */}
          <View style={styles.statGrid}>
            {(data?.stats || []).map((s) => (
              <View
                key={s.label}
                style={[styles.statCard, { backgroundColor: c.cardBackground, borderColor: c.border }]}
              >
                <Text style={[styles.statValue, { color: c.text }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: c.textSecondary }]} numberOfLines={2}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>

          {/* ── Revenue chart ── */}
          <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>Revenue</Text>
            {bars.length > 0 && (
              <View style={styles.chart}>
                {bars.map((b) => (
                  <View key={b.label} style={styles.chartCol}>
                    <View style={styles.chartBarTrack}>
                      <View
                        style={[
                          styles.chartBar,
                          {
                            height: `${Math.max((b.value / maxVal) * 100, 2)}%` as never,
                            backgroundColor: hasRevenue ? c.primary : 'rgba(120,150,210,0.25)',
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.chartLabel, { color: c.textFaint }]}>{b.label}</Text>
                  </View>
                ))}
              </View>
            )}
            {!hasRevenue && (
              <View style={styles.emptyOverlay}>
                <Text style={[styles.emptyTitle, { color: c.text }]}>No sales yet</Text>
                <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
                  Your revenue by day appears here after your first order.
                </Text>
              </View>
            )}
          </View>

          {/* ── Top products ── */}
          <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>Top products</Text>
            {(data?.topProducts || []).length === 0 ? (
              <View style={styles.emptyOverlay}>
                <Text style={[styles.emptyTitle, { color: c.text }]}>Nothing sold yet</Text>
                <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
                  Your best-selling products rank here after your first orders.
                </Text>
              </View>
            ) : (
              (data?.topProducts || []).map((p, i) => (
                <View key={p.name} style={[styles.productRow, i > 0 && { borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <Text style={[styles.productName, { color: c.text }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={[styles.productMeta, { color: c.textSecondary }]}>
                    {p.units} sold · {p.revenue}
                  </Text>
                </View>
              ))
            )}
          </View>

          {/* ── Traffic ── */}
          <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>Traffic</Text>
            <View style={styles.emptyOverlay}>
              <Text style={[styles.emptyTitle, { color: c.text }]}>No traffic data yet</Text>
              <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
                Viewer and visit metrics arrive once show analytics are wired to the ledger.
              </Text>
            </View>
          </View>
        </ScrollView>
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
  range: { fontSize: 12, fontFamily: Fonts.sansMedium },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two + Spacing.one, paddingBottom: 90 },
  note: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },

  errorBox: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, backgroundColor: 'rgba(229,72,77,0.08)' },
  errorText: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: 3,
  },
  statValue: { fontSize: 22, fontFamily: Fonts.sansSemiBold },
  statLabel: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 16 },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three + Spacing.one, gap: Spacing.two },
  cardTitle: { fontSize: 15.5, fontFamily: Fonts.sansSemiBold },

  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, height: 120 },
  chartCol: { flex: 1, alignItems: 'center', gap: 5, height: '100%' },
  chartBarTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  chartBar: { width: '100%', borderRadius: 4 },
  chartLabel: { fontSize: 9.5, fontFamily: Fonts.mono },

  emptyOverlay: { alignItems: 'center', gap: 3, paddingVertical: Spacing.two },
  emptyTitle: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
  emptyBody: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18, textAlign: 'center', maxWidth: 280 },

  productRow: { paddingVertical: Spacing.two, gap: 2 },
  productName: { fontSize: 14, fontFamily: Fonts.sansMedium },
  productMeta: { fontSize: 12.5, fontFamily: Fonts.sans },
});
