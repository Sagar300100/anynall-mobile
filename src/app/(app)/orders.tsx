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

import { DisplayText, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { listMyOrders, type BuyerOrder } from '@/lib/api';

function formatAmount(order: BuyerOrder) {
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
            <View
              style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}
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
                  {(item.status || 'pending').toUpperCase()}
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
                </View>
              )}
            </View>
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
