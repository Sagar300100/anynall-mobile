// Create a listing for a show — the two paths behind the Live Listings "+".
//
//   temporary — one page. The listing belongs to this show, never reaches the
//               marketplace, and the server refuses it without a show.
//   quality   — Listing Details, then Pricing. Carries photos, a description
//               and a condition grade, and stays in the catalogue afterwards.
//
// Everything here writes through POST /api/products, which validates all of
// it again server-side. Money is ₹ paise end to end.
//
// TWO CONTROLS ARE MARKED UNAVAILABLE RATHER THAN FAKED: "Add More Details"
// (per-category product attributes) and "Manage Variants" (size/colour
// variants) have no model in this backend at all — a variant isn't a field we
// can quietly drop on the product doc, it's a second inventory dimension with
// its own stock. They keep their place in the layout and say so on tap.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategorySheet } from '@/components/category-sheet';
import {
  FieldBox,
  FooterBar,
  InfoStrip,
  Label,
  NotYetTag,
  SectionTitle,
  SegTabs,
  SelectBox,
  SheetHeader,
  Stepper,
  ToggleCard,
  TONE,
} from '@/components/listing-parts';
import { Fonts, Spacing } from '@/constants/theme';
import { storage } from '@/lib/firebase';
import {
  CONDITIONS,
  createProduct,
  DESCRIPTION_MAX,
  HAZMAT_KINDS,
  IMAGES_MAX,
  PRICE_MAX_PAISE,
  PRICE_MIN_PAISE,
  STOCK_MAX,
  TIME_LIMITS,
  TITLE_MAX,
  type ProductKind,
} from '@/lib/seller-hub';

export type ListingMode = 'temporary' | 'quality';

/** Rupees typed by a human → integer paise. Null when unusable. */
function toPaise(rupees: string): number | null {
  const n = Number(rupees.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const paise = Math.round(n * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

const FORMATS: { value: ProductKind; label: string }[] = [
  { value: 'auction', label: 'Auction' },
  { value: 'buy-it-now', label: 'Buy It Now' },
  { value: 'giveaway', label: 'Giveaway' },
];

/** Shipping profiles we can genuinely honour today. A saved, reusable profile
 *  library doesn't exist yet, so these are the two real outcomes: the seller
 *  absorbs the cost, or the buyer is charged a flat fee that the order maths
 *  already understands. */
type ShippingProfile = 'free' | 'flat';
const SHIPPING_PROFILES: { value: ShippingProfile; label: string; body: string }[] = [
  { value: 'free', label: 'Free shipping', body: 'You absorb the delivery cost.' },
  { value: 'flat', label: 'Flat rate', body: 'The buyer pays a fixed fee you set.' },
];

export function CreateListing({
  mode,
  showId,
  uid,
  recentCategory,
  onClose,
  onCreated,
}: {
  mode: ListingMode;
  showId: string;
  uid: string | null;
  /** Last category this seller listed in, or ''. */
  recentCategory: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const insets = useSafeAreaInsets();
  const quality = mode === 'quality';

  const [step, setStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState('mint');
  const [allConditions, setAllConditions] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const [kind, setKind] = useState<ProductKind>('auction');
  const [price, setPrice] = useState('');
  const [seconds, setSeconds] = useState(30);
  const [timeOpen, setTimeOpen] = useState(false);
  const [suddenDeath, setSuddenDeath] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const [profile, setProfile] = useState<ShippingProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [shippingFee, setShippingFee] = useState('');
  const [weight, setWeight] = useState('');
  const [hazmat, setHazmat] = useState<string | null>(null);

  const [optionalOpen, setOptionalOpen] = useState(false);
  const [cost, setCost] = useState('');
  const [sku, setSku] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const giveaway = kind === 'giveaway';
  const paise = toPaise(price);
  const priceBad = !giveaway && price.length > 0 && (paise === null || paise < PRICE_MIN_PAISE || paise > PRICE_MAX_PAISE);
  const feePaise = toPaise(shippingFee);
  const costPaise = toPaise(cost);

  const detailsDone =
    category.length > 0 &&
    title.trim().length > 0 &&
    (!quality || (photos.length > 0 && description.trim().length > 0)) &&
    profile !== null &&
    (profile !== 'flat' || (feePaise !== null && feePaise > 0));

  const pricingDone = giveaway || (paise !== null && !priceBad);
  const canSubmit = detailsDone && pricingDone && !busy && !uploading;

  async function pickPhotos() {
    if (!uid) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Allow photo access to add listing photos.');
      return;
    }
    const room = IMAGES_MAX - photos.length;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: room,
    });
    if (res.canceled || !res.assets?.length) return;

    setUploading(true);
    setError(null);
    try {
      const urls: string[] = [];
      for (const asset of res.assets.slice(0, room)) {
        const blob = await (await fetch(asset.uri)).blob();
        // Storage rules cap uploads at 8 MB and require an image MIME type.
        if (blob.size > 8 * 1024 * 1024) {
          setError('One of those photos is over 8 MB. Pick smaller ones.');
          continue;
        }
        const objectRef = storageRef(storage, `productImages/${uid}/${Crypto.randomUUID()}.jpg`);
        const task = uploadBytesResumable(objectRef, blob, { contentType: 'image/jpeg' });
        await new Promise<void>((resolve, reject) => {
          task.on('state_changed', undefined, reject, () => resolve());
        });
        urls.push(await getDownloadURL(objectRef));
      }
      if (urls.length) setPhotos((p) => [...p, ...urls].slice(0, IMAGES_MAX));
    } catch {
      setError('Couldn’t upload those photos. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await createProduct({
        title: title.trim().slice(0, TITLE_MAX),
        // A giveaway still needs a price the server accepts — it is the stated
        // value of the item, and no payment is taken for this kind.
        price: giveaway ? PRICE_MIN_PAISE : (paise as number),
        stock: quantity,
        kind,
        category,
        description: description.trim(),
        condition: quality ? condition : undefined,
        images: photos,
        thumbnail_url: photos[0] ?? null,
        showId,
        temporary: mode === 'temporary',
        sku: sku.trim() || undefined,
        hazmat: hazmat ?? 'none',
        shippingFee: profile === 'flat' ? (feePaise as number) : 0,
        weightGrams: weight ? Number(weight) : undefined,
        costPaise: costPaise ?? undefined,
        auction:
          kind === 'auction'
            ? { startPrice: paise as number, durationSeconds: seconds, suddenDeath }
            : null,
      });
      onCreated();
    } catch {
      setError('Couldn’t create this listing. Check the details and try again.');
    } finally {
      setBusy(false);
    }
  }

  const shownConditions = allConditions ? CONDITIONS : CONDITIONS.slice(0, 3);
  const timeLabel = TIME_LIMITS.find((t) => t.seconds === seconds)?.label ?? `${seconds}s`;
  const profileLabel = SHIPPING_PROFILES.find((p) => p.value === profile)?.label ?? '';

  // ── Pricing block: shared by the temporary form and quality step 2 ──
  const pricing = (
    <>
      <SegTabs options={FORMATS} value={kind} onChange={setKind} />

      {kind === 'auction' && (
        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <FieldBox
              label="Starting Bid"
              required
              value={price}
              onChangeText={(t) => setPrice(t.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              prefix="₹"
              placeholder="1"
              accessibilityLabel="Starting bid in rupees"
            />
          </View>
          <View style={{ flex: 1 }}>
            <SelectBox
              label="Time Limit"
              required
              value={timeLabel}
              onPress={() => setTimeOpen(true)}
              accessibilityLabel="Auction time limit"
            />
          </View>
        </View>
      )}

      {kind === 'buy-it-now' && (
        <FieldBox
          label="Price"
          required
          value={price}
          onChangeText={(t) => setPrice(t.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          prefix="₹"
          placeholder="0"
          accessibilityLabel="Price in rupees"
        />
      )}

      {priceBad && <Text style={styles.error}>Enter an amount between ₹1 and ₹5,00,000.</Text>}

      {kind === 'auction' && (
        <ToggleCard
          title="Sudden Death"
          body="This means when you're down to 00:01, the last person to bid wins — the clock is never extended."
          value={suddenDeath}
          onValueChange={setSuddenDeath}
        />
      )}

      {giveaway && (
        <InfoStrip>No payment is taken for a giveaway. You still cover delivery.</InfoStrip>
      )}

      {/* Quality listings set quantity with the stepper in Listing Details,
          so it must not appear a second time on the pricing step. */}
      {!quality && (
        <FieldBox
          label="Quantity"
          required
          value={String(quantity)}
          onChangeText={(t) => {
            const n = Number(t.replace(/\D/g, ''));
            setQuantity(Number.isFinite(n) && n >= 1 ? Math.min(n, STOCK_MAX) : 1);
          }}
          keyboardType="number-pad"
          accessibilityLabel="Quantity"
        />
      )}
    </>
  );

  // ── Shipping block: shared by both paths ──
  const shipping = (
    <>
      <SectionTitle>Shipping</SectionTitle>
      <SelectBox
        label="Shipping Profile"
        required
        value={profileLabel}
        onPress={() => setProfileOpen(true)}
      />
      <InfoStrip>Sellers cover any shipping adjustments.</InfoStrip>

      {profile === 'flat' && (
        <FieldBox
          label="Flat shipping fee"
          required
          value={shippingFee}
          onChangeText={(t) => setShippingFee(t.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          prefix="₹"
          placeholder="0"
          accessibilityLabel="Flat shipping fee in rupees"
        />
      )}

      {quality && (
        <FieldBox
          label="Parcel weight (grams)"
          value={weight}
          onChangeText={(t) => setWeight(t.replace(/\D/g, '').slice(0, 5))}
          keyboardType="number-pad"
          placeholder="500"
          accessibilityLabel="Parcel weight in grams"
        />
      )}

      <ToggleCard
        title="Hazardous Materials"
        body="Carriers restrict shipping items that may pose risks to safety, like lithium batteries."
        value={hazmat !== null}
        onValueChange={(v) => setHazmat(v ? 'other-regulated' : null)}
      />
      {hazmat !== null && (
        <View style={styles.chips}>
          {HAZMAT_KINDS.map((h) => (
            <Pressable
              key={h.value}
              onPress={() => setHazmat(h.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: hazmat === h.value }}
              accessibilityLabel={h.label}
              style={({ pressed }) => [
                styles.chip,
                hazmat === h.value && styles.chipOn,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.chipText, hazmat === h.value && styles.chipTextOn]}>{h.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );

  // ── Optional (seller-only) fields ──
  const optional = (
    <>
      <View style={styles.divider} />
      <SectionTitle>Optional Fields</SectionTitle>
      <Text style={styles.body}>
        Set your cost per item and a SKU. Cost per item is stored privately and is only ever visible
        to you.
      </Text>
      <Pressable
        onPress={() => setOptionalOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: optionalOpen }}
        accessibilityLabel="See optional field options"
        style={({ pressed }) => [styles.seeOptions, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.seeOptionsText}>See Options</Text>
        <Ionicons name={optionalOpen ? 'chevron-up' : 'chevron-down'} size={18} color={TONE.primary} />
      </Pressable>
      {optionalOpen && (
        <>
          <FieldBox
            label="Cost per item"
            value={cost}
            onChangeText={(t) => setCost(t.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            prefix="₹"
            placeholder="0"
            accessibilityLabel="Cost per item in rupees"
          />
          <FieldBox
            label="SKU"
            value={sku}
            onChangeText={(t) => setSku(t.slice(0, 64))}
            placeholder="Your own reference"
            accessibilityLabel="SKU"
          />
          <InfoStrip>
            The SKU is stored on the listing itself, which buyers can read. Keep anything private in
            the cost field instead.
          </InfoStrip>
        </>
      )}
    </>
  );

  return (
    <>
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <SheetHeader
          title={quality ? 'Listing Details' : 'Create Temporary Listing'}
          onClose={quality ? undefined : onClose}
          onBack={quality ? () => (step === 2 ? setStep(1) : onClose()) : undefined}
        />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!quality && (
              <Text style={styles.body}>
                Temporary listings only appear in the live show they are assigned to. They are not
                available in the marketplace and expire when the show ends.
              </Text>
            )}

            {(!quality || step === 1) && (
              <>
                <SelectBox
                  label="Category"
                  required
                  value={category}
                  onPress={() => setCatOpen(true)}
                />

                {/* Real: the category this seller last listed in. Rendered
                    only when there genuinely is one. */}
                {!category && !!recentCategory && (
                  <Pressable
                    onPress={() => setCategory(recentCategory)}
                    accessibilityRole="button"
                    accessibilityLabel={`Use recently used category ${recentCategory}`}
                    style={({ pressed }) => [styles.recent, pressed && { opacity: 0.8 }]}
                  >
                    <Text style={styles.recentLabel}>Recently Used</Text>
                    <Text style={styles.recentValue}>{recentCategory}</Text>
                  </Pressable>
                )}

                {quality && (
                  <>
                    <Pressable
                      onPress={pickPhotos}
                      disabled={uploading || photos.length >= IMAGES_MAX}
                      accessibilityRole="button"
                      accessibilityLabel="Capture, scan or upload media"
                      style={({ pressed }) => [styles.mediaBox, pressed && { opacity: 0.8 }]}
                    >
                      {uploading ? (
                        <ActivityIndicator color={TONE.primary} />
                      ) : (
                        <>
                          <Ionicons name="camera-outline" size={28} color={TONE.text} />
                          <Label text="Capture, Scan or Upload Media" required />
                        </>
                      )}
                    </Pressable>
                    <Text style={styles.photoCount}>
                      Photos: {photos.length}/{IMAGES_MAX}
                    </Text>
                    {photos.length > 0 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
                        {photos.map((u) => (
                          <View key={u} style={styles.thumbWrap}>
                            <Image source={{ uri: u }} style={styles.thumb} contentFit="cover" />
                            <Pressable
                              onPress={() => setPhotos((p) => p.filter((x) => x !== u))}
                              accessibilityRole="button"
                              accessibilityLabel="Remove photo"
                              hitSlop={8}
                              style={styles.thumbRemove}
                            >
                              <Ionicons name="close" size={14} color="#FFFFFF" />
                            </Pressable>
                          </View>
                        ))}
                      </ScrollView>
                    )}
                    <InfoStrip>
                      Buyers must see the actual item. Photos of a different unit get listings removed.
                    </InfoStrip>
                  </>
                )}

                <FieldBox
                  label={`Title(${title.length}/${TITLE_MAX})`}
                  required
                  value={title}
                  onChangeText={(t) => setTitle(t.slice(0, TITLE_MAX))}
                  maxLength={TITLE_MAX}
                  accessibilityLabel="Listing title"
                />

                {quality && (
                  <>
                    <FieldBox
                      label={`Description(${description.length}/${DESCRIPTION_MAX})`}
                      required
                      value={description}
                      onChangeText={(t) => setDescription(t.slice(0, DESCRIPTION_MAX))}
                      maxLength={DESCRIPTION_MAX}
                      multiline
                      accessibilityLabel="Listing description"
                    />

                    <View style={styles.conditionCard}>
                      <Text style={styles.cardTitle}>Condition</Text>
                      <View style={styles.chips}>
                        {shownConditions.map((cn) => (
                          <Pressable
                            key={cn.value}
                            onPress={() => setCondition(cn.value)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: condition === cn.value }}
                            accessibilityLabel={cn.label}
                            style={({ pressed }) => [
                              styles.chip,
                              condition === cn.value && styles.chipOn,
                              pressed && { opacity: 0.8 },
                            ]}
                          >
                            <Text style={[styles.chipText, condition === cn.value && styles.chipTextOn]}>
                              {cn.label}
                            </Text>
                          </Pressable>
                        ))}
                        {!allConditions && (
                          <Pressable
                            onPress={() => setAllConditions(true)}
                            accessibilityRole="button"
                            accessibilityLabel="Show all conditions"
                            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]}
                          >
                            <Text style={styles.chipText}>…</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                    <InfoStrip>Accurate condition reduces refunds and disputes.</InfoStrip>

                    <Stepper label="Quantity Available" value={quantity} onChange={setQuantity} max={STOCK_MAX} />

                    <Unavailable
                      title="Add More Details"
                      body="Add more product attributes to this item."
                      reason="Per-category product attributes aren't built yet."
                    />

                    <View style={styles.divider} />
                    <SectionTitle>Product Variants</SectionTitle>
                    <Unavailable
                      title="Manage Variants"
                      body="Include available options and quantities."
                      reason="Variants need their own stock per option, which this catalogue doesn't model yet."
                    />
                    <View style={styles.divider} />
                  </>
                )}

                {!quality && pricing}
                {shipping}
                {!quality && optional}
              </>
            )}

            {quality && step === 2 && (
              <>
                <SectionTitle>Pricing</SectionTitle>
                {pricing}
                {optional}
              </>
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>

          <FooterBar
            primaryLabel={quality && step === 1 ? 'Next' : 'Add Listing'}
            onPrimary={quality && step === 1 ? () => setStep(2) : submit}
            onCancel={onClose}
            disabled={quality && step === 1 ? !detailsDone : !canSubmit}
            busy={busy}
            bottomInset={insets.bottom}
          />
        </KeyboardAvoidingView>
      </View>
    </Modal>

      {/* Siblings, not children — see the note in live-listings.tsx. */}
      <CategorySheet
        visible={catOpen}
        value={category}
        onSelect={setCategory}
        onClose={() => setCatOpen(false)}
      />

      <PickerSheet
        visible={timeOpen}
        title="Time Limit"
        options={TIME_LIMITS.map((t) => ({ value: String(t.seconds), label: t.label }))}
        selected={String(seconds)}
        onSelect={(v) => setSeconds(Number(v))}
        onClose={() => setTimeOpen(false)}
      />

      <PickerSheet
        visible={profileOpen}
        title="Shipping Profile"
        options={SHIPPING_PROFILES.map((p) => ({ value: p.value, label: p.label, body: p.body }))}
        selected={profile ?? ''}
        onSelect={(v) => setProfile(v as ShippingProfile)}
        onClose={() => setProfileOpen(false)}
        footnote="Saved, reusable shipping profiles aren't built yet — these are the two rates the order maths can honour today."
      />
    </>
  );
}

/** A row that keeps its place in the layout but has no backing feature. */
function Unavailable({ title, body, reason }: { title: string; body: string; reason: string }) {
  return (
    <Pressable
      onPress={() => Alert.alert(title, reason)}
      accessibilityRole="button"
      accessibilityLabel={`${title}. Not available yet`}
      style={({ pressed }) => [styles.unavailable, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <NotYetTag />
      </View>
      <Ionicons name="chevron-forward" size={20} color={TONE.faint} />
    </Pressable>
  );
}

/** Small bottom sheet of mutually exclusive options. */
function PickerSheet({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  footnote,
}: {
  visible: boolean;
  title: string;
  options: { value: string; label: string; body?: string }[];
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
  footnote?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.grabber} />
        <Text style={styles.pickerTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 340 }}>
          {options.map((o) => {
            const on = o.value === selected;
            return (
              <Pressable
                key={o.value}
                onPress={() => {
                  onSelect(o.value);
                  onClose();
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={o.label}
                style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.75 }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.pickerLabel}>{o.label}</Text>
                  {!!o.body && <Text style={styles.body}>{o.body}</Text>}
                </View>
                {on && <Ionicons name="checkmark" size={20} color={TONE.primary} />}
              </Pressable>
            );
          })}
        </ScrollView>
        {!!footnote && <Text style={styles.footnote}>{footnote}</Text>}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: TONE.bg },
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two + Spacing.one },
  body: { color: TONE.dim, fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 19 },
  cardTitle: { color: TONE.text, fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  error: { color: '#FF8B8B', fontSize: 13, fontFamily: Fonts.sans },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: TONE.border, marginVertical: Spacing.one },
  pair: { flexDirection: 'row', gap: Spacing.two },

  recent: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(20,36,70,0.9)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 3,
  },
  recentLabel: { color: TONE.dim, fontSize: 12.5, fontFamily: Fonts.sans },
  recentValue: { color: TONE.text, fontSize: 15, fontFamily: Fonts.sansSemiBold },

  mediaBox: {
    borderWidth: 1,
    borderColor: TONE.border,
    backgroundColor: TONE.surface,
    borderRadius: 12,
    minHeight: 128,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  photoCount: { color: TONE.dim, fontSize: 13, fontFamily: Fonts.sans, marginTop: -Spacing.one },
  thumbs: { gap: 10, paddingVertical: 2 },
  thumbWrap: { width: 76, height: 76 },
  thumb: { width: 76, height: 76, borderRadius: 10 },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(6,14,30,0.95)',
    borderWidth: 1,
    borderColor: TONE.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  conditionCard: {
    borderWidth: 1,
    borderColor: TONE.border,
    backgroundColor: TONE.surface,
    borderRadius: 12,
    padding: Spacing.two,
    gap: Spacing.two,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    backgroundColor: 'rgba(20,36,70,0.9)',
    borderWidth: 1,
    borderColor: TONE.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    minHeight: 42,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: TONE.primary, borderColor: TONE.primary },
  chipText: { color: TONE.text, fontSize: 14, fontFamily: Fonts.sansSemiBold },
  chipTextOn: { color: '#FFFFFF' },

  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: TONE.border,
    backgroundColor: TONE.surface,
    borderRadius: 12,
    padding: Spacing.two,
  },

  seeOptions: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44 },
  seeOptionsText: { color: TONE.primary, fontSize: 15, fontFamily: Fonts.sansSemiBold },

  backdrop: { ...(StyleSheet.absoluteFill as object), backgroundColor: 'rgba(2,6,16,0.6)' },
  pickerSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0C1730',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: TONE.border,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(120,150,210,0.35)',
    alignSelf: 'center',
    marginBottom: Spacing.two,
  },
  pickerTitle: { color: TONE.text, fontSize: 17, fontFamily: Fonts.sansSemiBold },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 56 },
  pickerLabel: { color: TONE.text, fontSize: 15.5, fontFamily: Fonts.sans },
  footnote: { color: TONE.faint, fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16, paddingTop: Spacing.one },
});
