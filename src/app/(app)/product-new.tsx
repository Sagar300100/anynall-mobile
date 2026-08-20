// Add a product to the seller's catalogue.
//
// Posts to POST /api/products, which is the same endpoint the web hub uses.
// `showId` is deliberately not sent: inventory that can only exist inside a
// show isn't inventory, so items are created standalone and attached to shows
// later.
//
// This form carries the SAME field set as the in-show CreateListing flow —
// category, condition, shipping fee, weight, box size, hazmat, SKU and cost.
// It used to stop at title/price/stock, which meant every catalogue item
// shipped free forever and booked its courier at the 50g fallback weight.
//
// The photo is optional but strongly encouraged, and the only provenance we
// ever claim is "uploaded" — buyers must only see real photos of the actual
// item, so there is no stock-image or generated-image path here.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategorySheet } from '@/components/category-sheet';
import { Card, CardTitle, ChoiceRow, Hint, Note, PrimaryCta, TAB_BAR_CLEARANCE } from '@/components/step5-parts';
import { Field, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { storage } from '@/lib/firebase';
import {
  CONDITIONS,
  createProduct,
  DIMENSION_MAX_CM,
  HAZMAT_KINDS,
  PRICE_MAX_PAISE,
  PRICE_MIN_PAISE,
  PRODUCT_KINDS,
  serverMessage,
  SHIPPING_MAX_PAISE,
  STOCK_MAX,
  TITLE_MAX,
  WEIGHT_MAX_GRAMS,
  type ProductKind,
} from '@/lib/seller-hub';
import { useSession } from '@/lib/session';

/** Rupees typed by a human → integer paise. Returns null when unusable. */
function toPaise(rupees: string): number | null {
  const n = Number(rupees.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const paise = Math.round(n * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

/** Like toPaise but ZERO is legal — the server accepts shippingFee 0, and a
 *  seller typing "0" under Flat rate must not be blocked with a max-fee error
 *  (they may not spot the separate Free-shipping radio). */
function toPaiseOrZero(rupees: string): number | null {
  if (!rupees.trim()) return null;
  const n = Number(rupees.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  const paise = Math.round(n * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

/** The two shipping outcomes the order maths can honour today: the seller
 *  absorbs delivery, or the buyer pays a flat fee. Same set as CreateListing. */
type ShippingProfile = 'free' | 'flat';
const SHIPPING_PROFILES: { value: ShippingProfile; label: string }[] = [
  { value: 'free', label: 'Free shipping — you absorb the delivery cost' },
  { value: 'flat', label: 'Flat rate — the buyer pays a fixed fee you set' },
];

/** `none` is the normal answer; the rest tell Shiprocket the parcel can't fly. */
const HAZMAT_CHOICES: { value: string; label: string }[] = [
  { value: 'none', label: 'None — ships normally' },
  ...HAZMAT_KINDS,
];

export default function NewProductScreen() {
  const c = useBrandColors();
  const { user } = useSession();

  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('1');
  const [kind, setKind] = useState<ProductKind>('buy-it-now');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [condition, setCondition] = useState('new');
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [profile, setProfile] = useState<ShippingProfile | null>(null);
  const [fee, setFee] = useState('');
  const [weight, setWeight] = useState('');
  const [dimL, setDimL] = useState('');
  const [dimB, setDimB] = useState('');
  const [dimH, setDimH] = useState('');
  const [hazmat, setHazmat] = useState('none');

  const [cost, setCost] = useState('');
  const [sku, setSku] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paise = toPaise(price);
  const stockN = Number(stock);
  const giveaway = kind === 'giveaway';
  const feePaise = toPaiseOrZero(fee);
  const costPaise = toPaise(cost);
  const weightN = weight.trim() ? Number(weight) : null;
  const dims = [dimL, dimB, dimH];
  const dimsGiven = dims.filter((d) => d.trim().length > 0).length;
  const dimNums = dims.map((d) => Number(d));

  const priceError =
    !giveaway && price.length > 0 && (paise === null || paise < PRICE_MIN_PAISE || paise > PRICE_MAX_PAISE);
  const stockError =
    stock.length > 0 && (!Number.isInteger(stockN) || stockN < 1 || stockN > STOCK_MAX);
  const feeError =
    profile === 'flat' &&
    fee.length > 0 &&
    (feePaise === null || feePaise > SHIPPING_MAX_PAISE);
  const weightError =
    weightN !== null && (!Number.isInteger(weightN) || weightN < 0 || weightN > WEIGHT_MAX_GRAMS);
  // The courier needs all three sides or none — a partial box is meaningless.
  const dimsError =
    (dimsGiven > 0 && dimsGiven < 3) ||
    (dimsGiven === 3 && dimNums.some((n) => !Number.isFinite(n) || n < 0 || n > DIMENSION_MAX_CM));

  const canSave =
    title.trim().length > 0 &&
    category.length > 0 &&
    (giveaway || (paise !== null && !priceError)) &&
    Number.isInteger(stockN) &&
    stockN >= 1 &&
    !stockError &&
    profile !== null &&
    (profile !== 'flat' || (feePaise !== null && !feeError)) &&
    !weightError &&
    !dimsError &&
    !busy &&
    !uploading;

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Allow photo access to add a product image.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    const uri = res.assets[0].uri;
    if (!user?.uid) return;

    setUploading(true);
    setError(null);
    try {
      const blob = await (await fetch(uri)).blob();
      // Storage rules cap this at 8 MB and require an image MIME type.
      if (blob.size > 8 * 1024 * 1024) {
        setError('That image is over 8 MB. Pick a smaller one.');
        return;
      }
      const name = `${Date.now()}.jpg`;
      const objectRef = storageRef(storage, `productImages/${user.uid}/${name}`);
      const task = uploadBytesResumable(objectRef, blob, { contentType: 'image/jpeg' });
      await new Promise<void>((resolve, reject) => {
        task.on('state_changed', undefined, reject, () => resolve());
      });
      setPhoto(await getDownloadURL(objectRef));
    } catch {
      setError('Couldn’t upload that photo. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await createProduct({
        title: title.trim().slice(0, TITLE_MAX),
        // A giveaway still needs a price the server accepts; it's the stated
        // value of the item, and no payment is taken for this kind.
        price: giveaway ? PRICE_MIN_PAISE : (paise as number),
        stock: stockN,
        kind,
        thumbnail_url: photo,
        description: description.trim(),
        category,
        condition,
        sku: sku.trim() || undefined,
        hazmat,
        // 0 = you absorb shipping; explicit, never accidental.
        shippingFee: profile === 'flat' ? (feePaise as number) : 0,
        weightGrams: weightN ?? undefined,
        dimensionsCm:
          dimsGiven === 3
            ? { length: dimNums[0], breadth: dimNums[1], height: dimNums[2] }
            : undefined,
        costPaise: costPaise ?? undefined,
      });
      router.back();
    } catch (err) {
      setError(serverMessage(err, 'Couldn’t save this product. Check the details and try again.'));
    } finally {
      setBusy(false);
    }
  }

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
        <Text style={[styles.topTitle, { color: c.text }]}>Add product</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: TAB_BAR_CLEARANCE }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Photo */}
          <Card>
            <CardTitle>Photo</CardTitle>
            <Pressable
              onPress={pickPhoto}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={photo ? 'Replace product photo' : 'Add a product photo'}
              style={({ pressed }) => [
                styles.photoBox,
                { borderColor: c.border, backgroundColor: c.cardBackground },
                pressed && { opacity: 0.8 },
              ]}
            >
              {uploading ? (
                <ActivityIndicator color={c.primary} />
              ) : photo ? (
                <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={26} color={c.primary} />
                  <Text style={[styles.photoHint, { color: c.textSecondary }]}>
                    Add a photo of the actual item
                  </Text>
                </>
              )}
            </Pressable>
            <Hint>
              Buyers must see the real item. Photos of something else, or of a different unit, get
              listings removed.
            </Hint>
          </Card>

          {/* Details */}
          <Card>
            <CardTitle>Details</CardTitle>
            <Field
              label="Title"
              value={title}
              onChangeText={(t) => setTitle(t.slice(0, TITLE_MAX))}
              maxLength={TITLE_MAX}
              placeholder="What are you selling?"
              accessibilityLabel="Product title"
            />

            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: c.textSecondary }]}>Category</Text>
              <Pressable
                onPress={() => setCatOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={
                  category ? `Category: ${category}. Change category` : 'Choose a category'
                }
                style={({ pressed }) => [
                  styles.select,
                  { borderColor: c.border, backgroundColor: c.backgroundElement },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text
                  style={[styles.selectValue, { color: category ? c.text : c.textFaint }]}
                  numberOfLines={1}
                >
                  {category || 'Choose a category'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={c.textSecondary} />
              </Pressable>
            </View>

            <View style={{ gap: 7 }} accessibilityRole="radiogroup">
              <Text style={[styles.label, { color: c.textSecondary }]}>Selling format</Text>
              {PRODUCT_KINDS.map((k) => (
                <ChoiceRow
                  key={k.value}
                  label={`${k.label} — ${k.hint}`}
                  selected={kind === k.value}
                  onPress={() => setKind(k.value)}
                />
              ))}
            </View>

            {!giveaway && (
              <>
                <Field
                  label="Price (₹)"
                  value={price}
                  onChangeText={(t) => setPrice(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  accessibilityLabel="Price in rupees"
                />
                {priceError && <Note tone="bad">Price must be between ₹1 and ₹5,00,000.</Note>}
              </>
            )}

            <Field
              label="Quantity"
              value={stock}
              onChangeText={(t) => setStock(t.replace(/\D/g, ''))}
              keyboardType="number-pad"
              placeholder="1"
              accessibilityLabel="Quantity in stock"
            />
            {stockError && <Note tone="bad">Quantity must be between 1 and {STOCK_MAX}.</Note>}

            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: c.textSecondary }]}>Condition</Text>
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
              <Hint>Accurate condition reduces refunds and disputes.</Hint>
            </View>

            <Field
              label="Description (optional)"
              value={description}
              onChangeText={setDescription}
              maxLength={2000}
              multiline
              numberOfLines={3}
              style={{ minHeight: 72, textAlignVertical: 'top' }}
              placeholder="Condition, size, what's included…"
              accessibilityLabel="Product description"
            />
          </Card>

          {/* Shipping — what the buyer pays and what the courier bills. */}
          <Card>
            <CardTitle>Shipping</CardTitle>
            <View style={{ gap: 7 }} accessibilityRole="radiogroup">
              {SHIPPING_PROFILES.map((p) => (
                <ChoiceRow
                  key={p.value}
                  label={p.label}
                  selected={profile === p.value}
                  onPress={() => setProfile(p.value)}
                />
              ))}
            </View>

            {profile === 'flat' && (
              <>
                <Field
                  label="Flat shipping fee (₹)"
                  value={fee}
                  onChangeText={(t) => setFee(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  accessibilityLabel="Flat shipping fee in rupees"
                />
                {feeError && <Note tone="bad">Shipping can be at most ₹5,000.</Note>}
              </>
            )}

            <Field
              label="Parcel weight (grams)"
              value={weight}
              onChangeText={(t) => setWeight(t.replace(/\D/g, '').slice(0, 5))}
              keyboardType="number-pad"
              placeholder="500"
              accessibilityLabel="Parcel weight in grams"
            />
            {weightError && <Note tone="bad">Weight can be at most {WEIGHT_MAX_GRAMS} g.</Note>}

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
            {dimsError ? (
              <Note tone="bad">
                Give all three sides, each up to {DIMENSION_MAX_CM} cm — or leave all three empty.
              </Note>
            ) : (
              <Hint>
                Couriers bill on the greater of weight and box size (L×B×H ÷ 5000). Without real
                numbers the label is booked at a 50g guess.
              </Hint>
            )}

            <View style={{ gap: 7 }} accessibilityRole="radiogroup">
              <Text style={[styles.label, { color: c.textSecondary }]}>Hazardous materials</Text>
              {HAZMAT_CHOICES.map((h) => (
                <ChoiceRow
                  key={h.value}
                  label={h.label}
                  selected={hazmat === h.value}
                  onPress={() => setHazmat(h.value)}
                />
              ))}
              <Hint>
                Lithium cells and aerosols can’t fly — declaring them here books the right courier
                mode instead of a failed pickup.
              </Hint>
            </View>
          </Card>

          {/* Seller-only extras */}
          <Card>
            <CardTitle>Optional</CardTitle>
            <Field
              label="Cost per item (₹)"
              value={cost}
              onChangeText={(t) => setCost(t.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0"
              accessibilityLabel="Cost per item in rupees"
            />
            <Hint>Cost per item is stored privately and is only ever visible to you.</Hint>
            <Field
              label="SKU"
              value={sku}
              onChangeText={(t) => setSku(t.slice(0, 64))}
              placeholder="Your own reference"
              accessibilityLabel="SKU"
            />
            <Hint>
              The SKU is stored on the listing itself, which buyers can read. Keep anything private
              in the cost field instead.
            </Hint>
          </Card>

          {!!error && <Note tone="bad">{error}</Note>}

          <PrimaryCta
            label="Save product"
            icon="checkmark"
            onPress={save}
            disabled={!canSave}
            busy={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <CategorySheet
        visible={catOpen}
        value={category}
        onSelect={setCategory}
        onClose={() => setCatOpen(false)}
      />
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
  scroll: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
    gap: Spacing.two + Spacing.one,
  },
  photoBox: {
    height: 168,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  photoHint: { fontSize: 12.5, fontFamily: Fonts.sans },
  label: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    minHeight: 48,
  },
  selectValue: { flex: 1, fontSize: 14.5, fontFamily: Fonts.sans },
  pair: { flexDirection: 'row', gap: Spacing.two },
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
