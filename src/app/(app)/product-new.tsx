// Add a product to the seller's catalogue.
//
// Posts to POST /api/products, which is the same endpoint the web hub uses.
// `showId` is deliberately not sent: inventory that can only exist inside a
// show isn't inventory, so items are created standalone and attached to shows
// later.
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

import { Card, CardTitle, ChoiceRow, Hint, Note, PrimaryCta, TAB_BAR_CLEARANCE } from '@/components/step5-parts';
import { Field, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { storage } from '@/lib/firebase';
import {
  createProduct,
  PRICE_MAX_PAISE,
  PRICE_MIN_PAISE,
  PRODUCT_KINDS,
  STOCK_MAX,
  TITLE_MAX,
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

export default function NewProductScreen() {
  const c = useBrandColors();
  const { user } = useSession();

  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('1');
  const [kind, setKind] = useState<ProductKind>('buy-it-now');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paise = toPaise(price);
  const stockN = Number(stock);
  const giveaway = kind === 'giveaway';

  const priceError =
    !giveaway && price.length > 0 && (paise === null || paise < PRICE_MIN_PAISE || paise > PRICE_MAX_PAISE);
  const stockError =
    stock.length > 0 && (!Number.isInteger(stockN) || stockN < 1 || stockN > STOCK_MAX);

  const canSave =
    title.trim().length > 0 &&
    (giveaway || (paise !== null && !priceError)) &&
    Number.isInteger(stockN) &&
    stockN >= 1 &&
    !stockError &&
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
      });
      router.back();
    } catch {
      setError('Couldn’t save this product. Check the details and try again.');
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
});
