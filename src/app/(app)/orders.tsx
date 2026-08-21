import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PayNowButton, orderAwaitingPayment } from '@/components/pay-now';
import { DisplayText, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { listMyOrders, type BuyerOrder } from '@/lib/api';
import { humanizeStatus } from '@/lib/commerce';

function formatAmount(order: BuyerOrder) {
  // A giveaway win is a real order with nothing owed — "₹0" reads like a
  // billing glitch, so say what it is.
  if (order.purchaseType === 'giveaway' && !(order.amount > 0)) return 'Giveaway — free';
  const rupees = (order.amount ?? 0) / 100; // paise → ₹, Razorpay convention
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function statusColor(status: string, c: ReturnType<typeof useBrandColors>) {
  switch ((status || '').toLowerCase()) {
    case 'paid':
    case 'confirmed':
    case 'delivered':
      return c.primary;
    case 'cancelled':
    case 'failed':
    case 'payment_failed':
    case 'payment_expired':
      return c.danger;
    default:
      return c.textSecondary;
  }
}

export default function OrdersScreen() {
  const c = useBrandColors();
  const [orders, setOrders] = useState<BuyerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (asRefresh = false) => {
    asRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setOrders(await listMyOrders());
    } catch {
      setError("Couldn't load your orders. Pull to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={c.text} />
        </Pressable>
        <DisplayText size={26}>Your orders.</DisplayText>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="bag-handle-outline" size={48} color={c.primary} />
              <Text style={[styles.emptyTitle, { color: c.text }]}>
                {error ?? 'No orders yet.'}
              </Text>
              {!error && (
                <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
                  Join a live show and grab your first drop.
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Order details for ${item.productTitle || 'order'}`}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: c.cardBackground, borderColor: c.border },
                pressed && { opacity: 0.8 },
              ]}
            >
              <View style={styles.cardTop}>
                <Text numberOfLines={2} style={[styles.title, { color: c.text }]}>
                  {item.productTitle || 'Order'}
                </Text>
                <Text style={[styles.amount, { color: c.text }]}>{formatAmount(item)}</Text>
              </View>
              <View style={styles.cardBottom}>
                <Text
                  style={[styles.status, { color: statusColor(item.status, c) }]}
                >
                  {humanizeStatus(item.status || 'pending').toUpperCase()}
                </Text>
                {item.createdAt && (
                  <Text style={[styles.date, { color: c.textSecondary }]}>
                    {new Date(item.createdAt).toLocaleDateString([], {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Text>
                )}
              </View>
              {item.shipment?.awbCode && (
                <View style={[styles.shipRow, { borderTopColor: c.border }]}>
                  <Ionicons name="cube-outline" size={15} color={c.primary} />
                  <Text style={[styles.shipText, { color: c.textSecondary }]}>
                    {item.shipment.courierName || 'Courier'} · AWB {item.shipment.awbCode}
                    {item.shipment.status ? ` · ${item.shipment.status}` : ''}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={c.textFaint} />
                </View>
              )}
              {/* The order has no delivery address yet (giveaway win, offer
                  accepted before one was saved) — v1: save the profile
                  address, the seller collects it from there. */}
              {item.needsAddress === true && !item.shipment?.awbCode && (
                <Pressable
                  onPress={() => router.push('/account/address')}
                  accessibilityRole="button"
                  accessibilityLabel="Add your delivery address so the seller can ship"
                  style={({ pressed }) => [
                    styles.shipRow,
                    { borderTopColor: c.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Ionicons name="location-outline" size={15} color={c.primary} />
                  <Text style={[styles.shipText, { color: c.textSecondary }]}>
                    Add your delivery address so the seller can ship
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={c.textFaint} />
                </Pressable>
              )}
              {/* Pay-now (Gap 8): an accepted offer creates the order server-
                  side, so this list is the buyer's checkout entry point. */}
              {orderAwaitingPayment(item) && (
                <PayNowButton order={item} onPaid={() => load(true)} />
              )}
            </Pressable>
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={c.primary} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.five,
  },
  list: { padding: Spacing.three, gap: Spacing.three, flexGrow: 1 },
  card: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  title: { flex: 1, fontSize: 15, fontFamily: Fonts.sansSemiBold, lineHeight: 20 },
  amount: { fontSize: 15, fontFamily: Fonts.mono },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  status: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.2 },
  date: { fontSize: 12, fontFamily: Fonts.sans },
  shipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderTopWidth: 1,
    paddingTop: Spacing.two,
  },
  shipText: { fontSize: 12, fontFamily: Fonts.sans, flex: 1 },
  emptyTitle: { fontSize: 20, fontFamily: Fonts.display },
  emptyBody: { fontSize: 14, fontFamily: Fonts.sans, textAlign: 'center' },
});
