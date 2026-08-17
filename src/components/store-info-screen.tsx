// Store Info — step 1 of seller onboarding, built to the approved COMPACT
// reference: header → "Store Info / Step 1 of 5" thin segmented progress →
// short title → ONE unified card (photo row + divider + store name +
// availability + rules) → compact "What you'll need" row → Continue.
// Fits a 360×800 screen at default font size; scrolling is a fallback.
//
// Availability truth lives on the server: the debounced check is advisory,
// and the Continue submit re-checks inside a Firestore transaction
// (storeNames/{canonical}), which is what actually prevents duplicates.
// Until that extended backend is deployed, the check endpoint 404s and the
// screen degrades honestly: no availability claims, save still goes through
// the existing atomic handle claim.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';

import { OnboardingStepHeader } from '@/components/onboarding-step-header';
import { RequirementsSheet } from '@/components/seller-intro';
import { Field, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { auth, storage } from '@/lib/firebase';
import {
  canonicalStoreName,
  checkStoreName,
  saveStoreSetup,
  sellerErrorCode,
  validateStoreNameLocal,
  type StepKey,
} from '@/lib/seller';

// Tab bar (58) + breathing room, on top of the safe-area inset — the
// primary CTA must never sit under the bottom navigation.
const TAB_BAR_CLEARANCE = 78;

const PHOTO_KEY_PREFIX = 'anynall:store-photo:'; // + uid — resume fallback pre-deployment

type NameStatus = 'empty' | 'invalid' | 'checking' | 'available' | 'taken' | 'error' | 'legacy';

const PHOTO_TIPS = [
  'Use a clear logo or product image',
  'Square images work best',
  'Avoid text-heavy images',
  'Use a bright, high-quality image',
];

/** Square-crop safety + ≤1024px + JPEG re-encode before upload. */
async function processPhoto(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  const side = Math.min(asset.width, asset.height);
  if (asset.width !== asset.height) {
    ctx.crop({
      originX: Math.floor((asset.width - side) / 2),
      originY: Math.floor((asset.height - side) / 2),
      width: side,
      height: side,
    });
  }
  if (side > 1024) ctx.resize({ width: 1024, height: 1024 });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({
    format: ImageManipulator.SaveFormat.JPEG,
    compress: 0.85,
  });
  return saved.uri;
}

/** Compact photo-tips bottom sheet (opened by the info icon). */
function TipsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: c.cardBackground, borderColor: c.border, paddingBottom: insets.bottom + Spacing.three },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: c.border }]} />
        <Text style={[styles.sheetTitle, { color: c.text }]}>Tips for a great photo</Text>
        {PHOTO_TIPS.map((t) => (
          <View key={t} style={styles.sheetRow}>
            <Ionicons name="checkmark-circle-outline" size={17} color={c.primary} />
            <Text style={[styles.sheetRowText, { color: c.textSecondary }]}>{t}</Text>
          </View>
        ))}
      </View>
    </Modal>
  );
}

export function StoreInfoScreen({
  initialName,
  initialPhotoUrl,
  onStepPress,
  onDone,
}: {
  initialName: string;
  initialPhotoUrl: string | null;
  /** Jump to an earlier completed step via the progress rail. */
  onStepPress?: (s: StepKey) => void;
  onDone: () => Promise<void> | void;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(initialName);
  // Async availability result — everything synchronous (empty/invalid/own
  // name) is DERIVED at render time instead, which keeps effects pure.
  const [asyncStatus, setAsyncStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid-server' | 'error' | 'legacy'
  >('idle');
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  // The input value the current async result belongs to — else it's stale.
  const checkedFor = useRef<string>(canonicalStoreName(initialName));
  const requestSeq = useRef(0);

  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl);
  const [photoBusy, setPhotoBusy] = useState<'idle' | 'processing' | 'uploading' | 'failed'>('idle');
  const [pendingAsset, setPendingAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoPermissionDenied, setPhotoPermissionDenied] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Pre-deployment resume fallback for the photo.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || initialPhotoUrl) return;
    AsyncStorage.getItem(PHOTO_KEY_PREFIX + uid).then((u) => {
      if (u) setPhotoUrl(u);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Debounced availability (async cases only) ────────────────────────────
  useEffect(() => {
    const canonical = canonicalStoreName(name);
    const needsCheck =
      !!canonical &&
      !validateStoreNameLocal(name) &&
      !(initialName && canonical === canonicalStoreName(initialName));
    if (!needsCheck) return;

    const seq = ++requestSeq.current;
    const t = setTimeout(async () => {
      setAsyncStatus('checking');
      try {
        const res = await checkStoreName(name);
        if (seq !== requestSeq.current) return; // stale — a newer input exists
        checkedFor.current = canonical;
        if (!res.deployed) {
          setAsyncStatus('legacy');
        } else if (res.available) {
          setAsyncStatus('available');
        } else if (res.reason === 'NAME_TAKEN') {
          setAsyncStatus('taken');
        } else {
          setServerMsg(res.message ?? 'That name isn’t allowed.');
          setAsyncStatus('invalid-server');
        }
      } catch {
        if (seq !== requestSeq.current) return;
        checkedFor.current = canonical;
        setAsyncStatus('error');
      }
    }, 500);
    return () => clearTimeout(t);
  }, [name, initialName, retryTick]);

  // ── Photo flow ───────────────────────────────────────────────────────────
  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted && perm.canAskAgain === false) {
      setPhotoPermissionDenied(true);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    setPhotoPermissionDenied(false);
    await uploadPhoto(result.assets[0]);
  }

  async function uploadPhoto(asset: ImagePicker.ImagePickerAsset) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setPendingAsset(asset);
    setPhotoBusy('processing');
    try {
      const processedUri = await processPhoto(asset);
      setPhotoBusy('uploading');
      const blob = await (await fetch(processedUri)).blob();
      const objectRef = storageRef(storage, `productImages/${uid}/store-logo-${Date.now()}.jpg`);
      const task = uploadBytesResumable(objectRef, blob, {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=86400',
      });
      await new Promise<void>((resolve, reject) => {
        task.on('state_changed', undefined, reject, () => resolve());
      });
      const url = await getDownloadURL(objectRef);
      setPhotoUrl(url);
      await AsyncStorage.setItem(PHOTO_KEY_PREFIX + uid, url);
      setPhotoBusy('idle');
      setPendingAsset(null);
    } catch {
      // Previous photo (photoUrl state) is untouched.
      setPhotoBusy('failed');
    }
  }

  async function removePhoto() {
    const uid = auth.currentUser?.uid;
    setPhotoUrl(null);
    setPendingAsset(null);
    setPhotoBusy('idle');
    if (uid) await AsyncStorage.removeItem(PHOTO_KEY_PREFIX + uid);
  }

  // ── Derived status (synchronous cases resolve at render time) ────────────
  const canonical = canonicalStoreName(name);
  const localError = validateStoreNameLocal(name);
  const isOwnUnchanged = !!initialName && canonical === canonicalStoreName(initialName);
  const statusIsCurrent = checkedFor.current === canonical;
  const status: NameStatus = !canonical
    ? 'empty'
    : localError
      ? 'invalid'
      : isOwnUnchanged
        ? 'available'
        : !statusIsCurrent
          ? 'checking'
          : asyncStatus === 'invalid-server'
            ? 'invalid'
            : asyncStatus === 'idle'
              ? 'checking'
              : asyncStatus;
  const statusMsg = localError ?? serverMsg;

  const continueEnabled =
    !submitting &&
    photoBusy !== 'processing' &&
    photoBusy !== 'uploading' &&
    canonical.length > 0 &&
    !localError &&
    (isOwnUnchanged || (statusIsCurrent && (asyncStatus === 'available' || asyncStatus === 'legacy')));

  async function submit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      // The transaction on the server is the authoritative uniqueness gate.
      await saveStoreSetup(name.trim(), undefined, photoUrl ?? undefined);
      await onDone();
    } catch (e) {
      const code = sellerErrorCode(e);
      if (code === 'NAME_TAKEN') {
        checkedFor.current = canonical;
        setAsyncStatus('taken');
      } else if (code === 'RESERVED' || code === 'INVALID_NAME') {
        checkedFor.current = canonical;
        setServerMsg(code === 'RESERVED' ? 'That store name is reserved.' : 'That name isn’t allowed.');
        setAsyncStatus('invalid-server');
      } else {
        setSubmitError('Could not save. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Compact availability line (render helper, not a component) ──────────
  function renderNameStatus() {
    if (status === 'empty' || status === 'legacy') return null;
    if (status === 'checking') {
      return (
        <View style={styles.statusLine} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={c.textSecondary} />
          <Text style={[styles.statusText, { color: c.textSecondary }]}>Checking availability…</Text>
        </View>
      );
    }
    if (status === 'available') {
      return (
        <View style={styles.statusLine} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle-outline" size={16} color="#34D399" />
          <Text style={[styles.statusText, { color: '#34D399' }]}>This store name is available</Text>
        </View>
      );
    }
    if (status === 'taken') {
      return (
        <View style={styles.statusLine} accessibilityLiveRegion="polite">
          <Ionicons name="close-circle-outline" size={16} color="#E5484D" />
          <Text style={[styles.statusText, { color: '#E5484D' }]}>
            This store name is already taken.{' '}
            <Text style={{ color: c.textSecondary }}>Try a different name.</Text>
          </Text>
        </View>
      );
    }
    if (status === 'error') {
      return (
        <View style={styles.statusLine} accessibilityLiveRegion="polite">
          <Ionicons name="cloud-offline-outline" size={15} color={c.textSecondary} />
          <Text style={[styles.statusText, { color: c.textSecondary, flex: 1 }]}>
            We couldn’t check this name right now
          </Text>
          <Pressable
            onPress={() => setRetryTick((t) => t + 1)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry check"
          >
            <Text style={{ color: c.primary, fontSize: 12.5, fontFamily: Fonts.sansSemiBold }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <Text style={[styles.statusText, { color: c.danger }]} accessibilityLiveRegion="polite">
        {statusMsg}
      </Text>
    );
  }

  const showPhoto = !!photoUrl || !!pendingAsset;
  const photoUploading = photoBusy === 'processing' || photoBusy === 'uploading';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <OnboardingStepHeader step="store" onStepPress={onStepPress} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Title ────────────────────────────────────────────────── */}
        <View style={{ gap: 5 }}>
          <Text style={[styles.h1, { color: c.text }]}>
            Create your <Text style={{ color: c.primary }}>store</Text>
          </Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>
            Choose a unique name and photo buyers will recognise.
          </Text>
        </View>

        {/* ── Unified store-identity card ──────────────────────────── */}
        <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
          {/* Photo row */}
          <View style={styles.photoRow}>
            {showPhoto ? (
              <View style={[styles.photoCircle, styles.photoPreview, { borderColor: c.border }]}>
                <Image
                  source={{ uri: pendingAsset?.uri ?? photoUrl ?? undefined }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                  transition={120}
                  accessibilityLabel="Store photo preview"
                />
                {photoUploading && (
                  <View style={styles.photoVeil} accessibilityLabel="Uploading store photo">
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  </View>
                )}
              </View>
            ) : (
              <Pressable
                onPress={pickPhoto}
                accessibilityRole="button"
                accessibilityLabel="Add store photo"
                style={({ pressed }) => [
                  styles.photoCircle,
                  { borderColor: 'rgba(74,143,229,0.55)', opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="camera-outline" size={24} color={c.primary} />
              </Pressable>
            )}

            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.photoTitleRow}>
                <Text style={[styles.rowTitle, { color: c.text }]}>Add store photo</Text>
                <Pressable
                  onPress={() => setTipsOpen(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Photo tips"
                >
                  <Ionicons name="information-circle-outline" size={16} color={c.primary} />
                </Pressable>
              </View>
              <Text style={[styles.rowSub, { color: c.textSecondary }]}>
                Optional · You can change it later
              </Text>
              {photoBusy === 'failed' ? (
                <View style={styles.photoBtnRow}>
                  <Pressable
                    onPress={() => pendingAsset && uploadPhoto(pendingAsset)}
                    accessibilityRole="button"
                    accessibilityLabel="Retry upload"
                    style={({ pressed }) => [styles.photoBtn, { borderColor: 'rgba(74,143,229,0.55)', opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.photoBtnText, { color: c.primary }]}>Retry upload</Text>
                  </Pressable>
                  <Pressable
                    onPress={removePhoto}
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                    hitSlop={6}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, justifyContent: 'center' })}
                  >
                    <Text style={[styles.photoLink, { color: '#E5484D' }]}>Remove</Text>
                  </Pressable>
                </View>
              ) : showPhoto ? (
                <View style={styles.photoBtnRow}>
                  <Pressable
                    onPress={pickPhoto}
                    disabled={photoUploading}
                    accessibilityRole="button"
                    accessibilityLabel="Replace photo"
                    style={({ pressed }) => [styles.photoBtn, { borderColor: 'rgba(74,143,229,0.55)', opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.photoBtnText, { color: c.primary }]}>Replace</Text>
                  </Pressable>
                  <Pressable
                    onPress={removePhoto}
                    disabled={photoUploading}
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                    hitSlop={6}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, justifyContent: 'center' })}
                  >
                    <Text style={[styles.photoLink, { color: '#E5484D' }]}>Remove</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={pickPhoto}
                  accessibilityRole="button"
                  accessibilityLabel="Choose photo"
                  style={({ pressed }) => [
                    styles.photoBtn,
                    { borderColor: 'rgba(74,143,229,0.55)', opacity: pressed ? 0.7 : 1, alignSelf: 'flex-start' },
                  ]}
                >
                  <Text style={[styles.photoBtnText, { color: c.primary }]}>Choose photo</Text>
                </Pressable>
              )}
            </View>
          </View>

          {photoPermissionDenied && (
            <View style={styles.statusLine}>
              <Ionicons name="lock-closed-outline" size={14} color={c.textSecondary} />
              <Text style={[styles.statusText, { color: c.textSecondary, flex: 1 }]}>
                Photo access is off — allow it in system settings.
              </Text>
              <Pressable onPress={() => Linking.openSettings().catch(() => {})} hitSlop={8}>
                <Text style={{ color: c.primary, fontSize: 12.5, fontFamily: Fonts.sansSemiBold }}>Settings</Text>
              </Pressable>
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: c.border }]} />

          {/* Store name */}
          <View style={styles.nameHead}>
            <View style={[styles.nameIcon, { backgroundColor: 'rgba(99,102,241,0.16)' }]}>
              <Ionicons name="storefront-outline" size={17} color="#8B9CF6" />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={[styles.rowTitle, { color: c.text }]}>Store name</Text>
              <Text style={[styles.rowSub, { color: c.textSecondary }]}>
                Choose a unique name for your store
              </Text>
            </View>
          </View>
          <Field
            label=""
            value={name}
            onChangeText={setName}
            placeholder="Enter your store name"
            maxLength={30}
            autoCorrect={false}
            accessibilityLabel="Store name"
            rightSlot={
              name.length > 0 ? (
                <Pressable
                  onPress={() => setName('')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear store name"
                >
                  <Ionicons name="close-circle" size={18} color={c.textSecondary} />
                </Pressable>
              ) : undefined
            }
          />
          {renderNameStatus()}
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <View style={styles.rulesRow}>
            <Ionicons name="information-circle" size={14} color={c.primary} />
            <Text style={[styles.rulesText, { color: c.textFaint }]}>
              3–30 characters · Letters, numbers, spaces and approved punctuation
            </Text>
          </View>
        </View>

        {/* ── What you'll need row ─────────────────────────────────── */}
        <Pressable
          onPress={() => setReqOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="What you'll need — view seller requirements"
          style={({ pressed }) => [
            styles.needRow,
            { backgroundColor: c.cardBackground, borderColor: c.border },
            pressed && { backgroundColor: 'rgba(120,150,210,0.08)' },
          ]}
        >
          <View style={[styles.nameIcon, { backgroundColor: 'rgba(99,102,241,0.16)' }]}>
            <Ionicons name="reader-outline" size={17} color="#8B9CF6" />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={[styles.rowTitle, { color: c.text }]}>What you’ll need</Text>
            <Text style={[styles.rowSub, { color: c.textSecondary }]}>
              ID verification, PAN or tax details, and a bank account for payouts.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
        </Pressable>

        {!!submitError && (
          <Text style={[styles.statusText, { color: c.danger }]} accessibilityLiveRegion="polite">
            {submitError}
          </Text>
        )}

        {/* ── CTA ──────────────────────────────────────────────────── */}
        <Pressable
          onPress={submit}
          disabled={!continueEnabled}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityState={{ disabled: !continueEnabled, busy: submitting }}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: '#2E6BFF' },
            !continueEnabled && { opacity: 0.45 },
            pressed && continueEnabled && { opacity: 0.85 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.ctaText}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
            </>
          )}
        </Pressable>
      </ScrollView>

      <TipsSheet visible={tipsOpen} onClose={() => setTipsOpen(false)} />
      <RequirementsSheet visible={reqOpen} onClose={() => setReqOpen(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two + Spacing.one,
  },

  h1: { fontSize: 25, fontFamily: Fonts.sansSemiBold, lineHeight: 31 },
  sub: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 19 },

  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.two + Spacing.one,
    gap: Spacing.two,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one },
  photoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPreview: { borderStyle: 'solid', overflow: 'hidden' },
  photoVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4,10,26,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  rowSub: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 16.5 },
  photoBtnRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: 4 },
  photoBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: 8,
    marginTop: 2,
  },
  photoBtnText: { fontSize: 13, fontFamily: Fonts.sansMedium },
  photoLink: { fontSize: 13, fontFamily: Fonts.sansMedium },

  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 2 },

  nameHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one },
  nameIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusText: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
  rulesRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  rulesText: { flex: 1, fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 15.5 },

  needRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two + 2,
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 55,
    borderRadius: 16,
  },
  ctaText: { color: '#FFFFFF', fontSize: 17, fontFamily: Fonts.sansSemiBold },

  backdrop: { flex: 1, backgroundColor: 'rgba(2,5,14,0.6)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 17, fontFamily: Fonts.sansSemiBold, marginTop: Spacing.one },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one, paddingVertical: 6 },
  sheetRowText: { flex: 1, fontSize: 13.5, fontFamily: Fonts.sans },
});
