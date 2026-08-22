// Inventory — the seller's real product catalogue.
//
// Reads GET /api/products/mine?all=1. The `all=1` matters: the default
// response collapses duplicate title+price pairs for the "reuse a listing"
// picker, which would under-report what the seller actually owns.
//
// Tapping a row opens the edit sheet, which writes through
// PATCH /api/products/:id — the same route the web hub's Inventory panel
// uses. The server refuses edits that would oversell (stock below what is
// already sold/reserved) and refuses to draft/deactivate a product still
// attached to a show; both surface here as the server's own sentence rather
// than a silent no-op.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { ChoiceRow, Hint, Note, PrimaryCta, TAB_BAR_CLEARANCE, TONE } from '@/components/step5-parts';
import { Field, useBrandColors } from '@/components/ui/form';
import { Brand, CtaGradientShell, Fonts, Spacing } from '@/constants/theme';
import { formatPaise } from '@/lib/commerce';
import {
  CONDITIONS,
  DIMENSION_MAX_CM,
  getMyProducts,
  PRICE_MAX_PAISE,
  PRICE_MIN_PAISE,
  PRODUCT_STATUSES,
  serverMessage,
  SHIPPING_MAX_PAISE,
  STOCK_MAX,
  updateProduct,
  WEIGHT_MAX_GRAMS,
  type ProductPatch,
  type ProductStatus,
  type SellerProduct,
} from '@/lib/seller-hub';

const KIND_LABEL: Record<string, string> = {
  'buy-it-now': 'Buy Now',
  auction: 'Auction',
  giveaway: 'Giveaway',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  inactive: 'Inactive',
};

/** Rupees typed by a human → integer paise. Null when unusable. */
function toPaise(rupees: string): number | null {
  const n = Number(rupees.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const paise = Math.round(n * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

/** Like toPaise but where 0 (and blank) is a legitimate answer — shipping. */
function toPaiseOrZero(rupees: string): number | null {
  if (!rupees.trim()) return 0;
  const n = Number(rupees.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  const paise = Math.round(n * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

export default function InventoryScreen() {
  const c = useBrandColors();
  const [items, setItems] = useState<SellerProduct[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<SellerProduct | null>(null);

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
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <PressScale
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/sell'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </PressScale>
        <Text style={[styles.topTitle, { color: c.text }]}>Inventory</Text>
        <PressScale
          onPress={() => router.push('/product-new')}
          accessibilityRole="button"
          accessibilityLabel="Add product"
          hitSlop={8}
          style={[styles.addBtn, { borderColor: 'rgba(74,143,229,0.55)' }]}
        >
          <Ionicons name="add" size={20} color={c.primary} />
        </PressScale>
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
            <PressScale
              onPress={() => router.push('/product-new')}
              accessibilityRole="button"
              accessibilityLabel="Add your first product"
              style={styles.emptyCta}
            >
              <LinearGradient
                colors={[...CtaGradientShell]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.emptyCtaFill}
              >
                <Ionicons name="add" size={18} color="#FFFFFF" />
                <Text style={styles.emptyCtaText}>Add product</Text>
              </LinearGradient>
            </PressScale>
          </View>
        ) : (
          items.map((p) => {
            // Remaining = stock − sold. Total stock alone overstated what was
            // left to sell. NOTE: the purchase path additionally subtracts
            // active buy-now reservations, but GET /products/mine doesn't
            // return them — so this can briefly overstate by units sitting in
            // a 15-min reservation. Exact parity needs the API to expose
            // reserved/reservedUntil.
            const left = Math.max(0, p.stock - p.sold);
            const out = left <= 0;
            return (
              <PressScale
                key={p.id}
                onPress={() => setEditing(p)}
                accessibilityRole="button"
                accessibilityLabel={`${p.title}, ${formatPaise(p.price)}, ${
                  out ? 'sold out' : `${left} left`
                }. Edit listing`}
                style={styles.row}
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
                    {[
                      KIND_LABEL[p.kind] ?? p.kind,
                      STATUS_LABEL[p.status] ?? null,
                      p.sold > 0 ? `${p.sold} sold` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Text style={styles.price}>{formatPaise(p.price)}</Text>
                  {/* Stock state is written out, not signalled by colour alone. */}
                  <Text style={[styles.stock, { color: out ? TONE.bad : c.textSecondary }]}>
                    {out ? 'Sold out' : `${left} left`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
              </PressScale>
            );
          })
        )}
      </ScrollView>

      {/* Mounted fresh per item so its state initialises from that item. */}
      {editing && (
        <EditSheet
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      </SafeAreaView>
    </View>
  );
}

/* ── Edit sheet: the day-to-day dials — PATCH /api/products/:id ── */

function EditSheet({
  item,
  onClose,
  onSaved,
}: {
  item: SellerProduct;
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();

  const [price, setPrice] = useState(String(item.price / 100));
  const [stock, setStock] = useState(String(item.stock));
  const [fee, setFee] = useState(item.shippingFee > 0 ? String(item.shippingFee / 100) : '');
  const [weight, setWeight] = useState(item.weightGrams != null ? String(item.weightGrams) : '');
  const [dimL, setDimL] = useState(item.dimensionsCm ? String(item.dimensionsCm.length) : '');
  const [dimB, setDimB] = useState(item.dimensionsCm ? String(item.dimensionsCm.breadth) : '');
  const [dimH, setDimH] = useState(item.dimensionsCm ? String(item.dimensionsCm.height) : '');
  const [condition, setCondition] = useState(item.condition);
  const [sku, setSku] = useState(item.sku);
  const [status, setStatus] = useState<ProductStatus>(
    (PRODUCT_STATUSES.some((s) => s.value === item.status) ? item.status : 'active') as ProductStatus
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paise = toPaise(price);
  const stockN = Number(stock);
  const feePaise = toPaiseOrZero(fee);
  const weightN = weight.trim() ? Number(weight) : null;
  const dims = [dimL, dimB, dimH];
  const dimsGiven = dims.filter((d) => d.trim().length > 0).length;
  const dimNums = dims.map((d) => Number(d));

  const priceBad = paise === null || paise < PRICE_MIN_PAISE || paise > PRICE_MAX_PAISE;
  const stockBad = !Number.isInteger(stockN) || stockN < 1 || stockN > STOCK_MAX;
  const feeBad = feePaise === null || feePaise > SHIPPING_MAX_PAISE;
  const weightBad =
    weightN !== null && (!Number.isInteger(weightN) || weightN < 0 || weightN > WEIGHT_MAX_GRAMS);
  // The server takes all three sides or none — a partial box is meaningless.
  const dimsBad =
    (dimsGiven > 0 && dimsGiven < 3) ||
    (dimsGiven === 3 && dimNums.some((n) => !Number.isFinite(n) || n < 0 || n > DIMENSION_MAX_CM));

  const canSave = !priceBad && !stockBad && !feeBad && !weightBad && !dimsBad && !saving;

  async function save() {
    setError(null);

    // Only what actually changed goes on the wire — the server 400s an empty
    // patch, and an unchanged status must not trip the in-show guard.
    const patch: ProductPatch = {};
    if (paise !== null && paise !== item.price) patch.price = paise;
    if (stockN !== item.stock) patch.stock = stockN;
    if (feePaise !== null && feePaise !== item.shippingFee) patch.shippingFee = feePaise;
    if (weightN !== null && weightN !== item.weightGrams) patch.weightGrams = weightN;
    if (dimsGiven === 3) {
      const [length, breadth, height] = dimNums;
      const prev = item.dimensionsCm;
      if (!prev || prev.length !== length || prev.breadth !== breadth || prev.height !== height) {
        patch.dimensionsCm = { length, breadth, height };
      }
    }
    if (condition !== item.condition) patch.condition = condition;
    if (sku.trim() !== item.sku) patch.sku = sku.trim();
    if (status !== item.status) patch.status = status;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await updateProduct(item.id, patch);
      onSaved();
    } catch (err) {
      // The 409s carry real sentences — "N unit(s) are already sold or
      // reserved…", "Remove this product from its show before…".
      setError(serverMessage(err, 'Couldn’t save these changes. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close editor" />
      <View
        style={[
          styles.sheet,
          { backgroundColor: c.background, borderColor: c.border, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.grabber} />
        <View style={styles.sheetHead}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.sheetKicker, { color: c.textSecondary }]}>Edit listing</Text>
            <Text style={[styles.sheetTitle, { color: c.text }]} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
        </View>

        {/* flexShrink so the ScrollView stays inside the sheet's maxHeight
            instead of pushing the save button off screen. */}
        <KeyboardAvoidingView
          style={{ flexShrink: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.sheetScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.pair}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Price (₹)"
                  value={price}
                  onChangeText={(t) => setPrice(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Price in rupees"
                  error={priceBad && price.length > 0 ? 'Between ₹1 and ₹5,00,000.' : null}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Quantity"
                  value={stock}
                  onChangeText={(t) => setStock(t.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  accessibilityLabel="Quantity in stock"
                  error={stockBad && stock.length > 0 ? `Between 1 and ${STOCK_MAX}.` : null}
                />
              </View>
            </View>
            {item.sold > 0 && (
              <Hint>
                {item.sold} already sold — the server won’t let quantity go below what is sold or
                reserved.
              </Hint>
            )}

            <View style={styles.pair}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Shipping fee (₹)"
                  value={fee}
                  onChangeText={(t) => setFee(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="0 = free"
                  accessibilityLabel="Shipping fee in rupees"
                  error={feeBad ? 'Up to ₹5,000.' : null}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Weight (g)"
                  value={weight}
                  onChangeText={(t) => setWeight(t.replace(/\D/g, '').slice(0, 5))}
                  keyboardType="number-pad"
                  placeholder="500"
                  accessibilityLabel="Parcel weight in grams"
                  error={weightBad ? `Up to ${WEIGHT_MAX_GRAMS} g.` : null}
                />
              </View>
            </View>

            <View style={styles.pair}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Length (cm)"
                  value={dimL}
                  onChangeText={(t) => setDimL(t.replace(/[^0-9.]/g, '').slice(0, 5))}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Parcel length in centimetres"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Breadth (cm)"
                  value={dimB}
                  onChangeText={(t) => setDimB(t.replace(/[^0-9.]/g, '').slice(0, 5))}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Parcel breadth in centimetres"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Height (cm)"
                  value={dimH}
                  onChangeText={(t) => setDimH(t.replace(/[^0-9.]/g, '').slice(0, 5))}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Parcel height in centimetres"
                />
              </View>
            </View>
            {dimsBad ? (
              <Note tone="bad">
                Give all three sides, each up to {DIMENSION_MAX_CM} cm — couriers bill on the box
                size too.
              </Note>
            ) : (
              <Hint>
                Couriers bill on the greater of weight and box size (L×B×H ÷ 5000).
                {item.weightGrams != null || item.dimensionsCm
                  ? ' Leaving weight or dimensions blank keeps the saved values — they can be changed but not removed.'
                  : ''}
              </Hint>
            )}

            <Text style={[styles.groupLabel, { color: c.textSecondary }]}>Condition</Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {CONDITIONS.map((cn) => {
                const on = condition === cn.value;
                return (
                  <Pressable
                    key={cn.value}
                    onPress={() => setCondition(cn.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={cn.label}
                    style={({ pressed }) => [
                      styles.chip,
                      { borderColor: on ? c.primary : c.border },
                      on && { backgroundColor: 'rgba(46,107,255,0.16)' },
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: on ? c.primary : c.textSecondary }]}>
                      {cn.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Field
              label="SKU (optional)"
              value={sku}
              onChangeText={(t) => setSku(t.slice(0, 64))}
              placeholder="Your own reference"
              accessibilityLabel="SKU"
            />

            <Text style={[styles.groupLabel, { color: c.textSecondary }]}>Status</Text>
            <View style={{ gap: 7 }} accessibilityRole="radiogroup">
              {PRODUCT_STATUSES.map((s) => (
                <ChoiceRow
                  key={s.value}
                  label={`${s.label} — ${s.hint}`}
                  selected={status === s.value}
                  onPress={() => setStatus(s.value)}
                />
              ))}
            </View>
            {status !== 'active' && item.showId ? (
              <Hint>
                This product is attached to a show — the server will refuse to draft or deactivate
                it until it’s removed from the show.
              </Hint>
            ) : null}

            {!!error && <Note tone="bad">{error}</Note>}

            <PrimaryCta
              label="Save changes"
              icon="checkmark"
              onPress={save}
              disabled={!canSave}
              busy={saving}
            />
          </ScrollView>
        </KeyboardAvoidingView>
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
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    minHeight: 44,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 21, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
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
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: Spacing.two,
  },
  thumb: { width: 54, height: 54, borderRadius: 10 },
  thumbEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13.5, fontFamily: Fonts.uiSemiBold },
  meta: { fontSize: 11.5, fontFamily: Fonts.ui },
  price: { fontSize: 13.5, fontFamily: Fonts.uiExtraBold, color: Brand.blueSky },
  stock: { fontSize: 11, fontFamily: Fonts.ui },

  empty: { alignItems: 'center', gap: 8, paddingTop: Spacing.four },
  emptyTitle: { fontSize: 18, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  emptyBody: {
    fontSize: 12.5,
    fontFamily: Fonts.ui,
    lineHeight: 17.5,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },
  emptyCta: { borderRadius: 13, marginTop: Spacing.two },
  emptyCtaFill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 13,
    paddingHorizontal: Spacing.four,
    minHeight: 48,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  emptyCtaText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.uiBold },

  backdrop: { ...(StyleSheet.absoluteFill as object), backgroundColor: 'rgba(2,6,16,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '90%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,150,210,0.35)',
    alignSelf: 'center',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  sheetKicker: { fontSize: 11.5, fontFamily: Fonts.sansMedium, textTransform: 'uppercase' },
  sheetTitle: { fontSize: 17, fontFamily: Fonts.sansSemiBold },
  sheetScroll: { gap: Spacing.two, paddingBottom: Spacing.four },
  pair: { flexDirection: 'row', gap: Spacing.two },
  groupLabel: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontFamily: Fonts.sansMedium },
});
