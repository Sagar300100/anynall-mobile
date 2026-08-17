// Inventory — the seller's real product catalogue.
//
// Reads GET /api/products/mine?all=1. The `all=1` matters: the default
// response collapses duplicate title+price pairs for the "reuse a listing"
// picker, which would under-report what the seller actually owns.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Note, TAB_BAR_CLEARANCE, TONE } from '@/components/step5-parts';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { formatPaise } from '@/lib/commerce';
import { getMyProducts, type SellerProduct } from '@/lib/seller-hub';

const KIND_LABEL: Record<string, string> = {
  'buy-it-now': 'Buy Now',
  auction: 'Auction',
  giveaway: 'Giveaway',
};

export default function InventoryScreen() {
  const c = useBrandColors();
  const [items, setItems] = useState<SellerProduct[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getMyProducts();
      setItems(r.products);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // Refetch on focus so a product added on the next screen shows up on return.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const r = await getMyProducts();
          if (!cancelled) {
            setItems(r.products);
            setFailed(false);
          }
        } catch {
          if (!cancelled) setFailed(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/sell'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Inventory</Text>
        <Pressable
          onPress={() => router.push('/product-new')}
          accessibilityRole="button"
          accessibilityLabel="Add product"
          hitSlop={8}
          style={({ pressed }) => [
            styles.addBtn,
            { borderColor: 'rgba(74,143,229,0.55)', opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="add" size={20} color={c.primary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: TAB_BAR_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={async () => {
              setBusy(true);
              await load();
              setBusy(false);
            }}
            tintColor={c.textSecondary}
          />
        }
      >
        {failed && (
          <Note tone="bad" icon="cloud-offline-outline">
            We couldn’t load your inventory. Pull down to retry.
          </Note>
        )}

        {items === null ? null : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="pricetag-outline" size={30} color={c.textFaint} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>No products yet</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
              Add your first item and it’ll be ready to sell in a live show or on its own.
            </Text>
            <Pressable
              onPress={() => router.push('/product-new')}
              accessibilityRole="button"
              accessibilityLabel="Add your first product"
              style={({ pressed }) => [
                styles.emptyCta,
                { backgroundColor: '#2E6BFF' },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="add" size={18} color="#FFFFFF" />
              <Text style={styles.emptyCtaText}>Add product</Text>
            </Pressable>
          </View>
        ) : (
          items.map((p) => {
            const out = p.stock <= 0;
            return (
              <View
                key={p.id}
                style={[styles.row, { backgroundColor: c.cardBackground, borderColor: c.border }]}
                accessible
                accessibilityLabel={`${p.title}, ${formatPaise(p.price)}, ${out ? 'out of stock' : `${p.stock} in stock`}`}
              >
                {p.thumbnail_url ? (
                  <Image source={{ uri: p.thumbnail_url }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty, { borderColor: c.border }]}>
                    <Ionicons name="image-outline" size={18} color={c.textFaint} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
                    {p.title}
                  </Text>
                  <Text style={[styles.meta, { color: c.textSecondary }]}>
                    {[KIND_LABEL[p.kind] ?? p.kind, p.sold > 0 ? `${p.sold} sold` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Text style={[styles.price, { color: c.text }]}>{formatPaise(p.price)}</Text>
                  {/* Stock state is written out, not signalled by colour alone. */}
                  <Text style={[styles.stock, { color: out ? TONE.bad : c.textSecondary }]}>
                    {out ? 'Out of stock' : `${p.stock} left`}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
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
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    minHeight: 44,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 21, fontFamily: Fonts.sansSemiBold },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingHorizontal: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.two,
  },
  thumb: { width: 54, height: 54, borderRadius: 10 },
  thumbEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
  meta: { fontSize: 11.5, fontFamily: Fonts.sans },
  price: { fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  stock: { fontSize: 11, fontFamily: Fonts.sans },

  empty: { alignItems: 'center', gap: 8, paddingTop: Spacing.four },
  emptyTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  emptyBody: {
    fontSize: 12.5,
    fontFamily: Fonts.sans,
    lineHeight: 17.5,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    paddingHorizontal: Spacing.four,
    minHeight: 48,
    marginTop: Spacing.two,
  },
  emptyCtaText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.sansSemiBold },
});
