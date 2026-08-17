// Profile tab.
//
// Signed in: account header (real photo when Firebase Auth has one, otherwise
// the first letter of the real display name), a single grouped menu of rows
// that all navigate somewhere real, a confirmed destructive sign-out, and a
// footer whose version is read from app config — never hardcoded.
//
// Guest: sign-in prompt plus the public pages (help, contact, legal) that
// exist on anynall.com today.
//
// HONEST OMISSIONS (deliberate, not oversights):
// - No Notifications row: the app has no notification centre or push setup.
// - No separate Payment methods row: Razorpay holds card details; we only
//   store a payment *preference*, edited alongside the address below.
//
// Photo upload (avatar camera button → use-profile-photo) writes to
// Storage /avatars/{uid}; the matching storage.rules block must be deployed
// or the bucket rejects the upload.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardRow, SignOutRow } from '@/components/account-menu';
import { GetReadySheet } from '@/components/get-ready-sheet';
import { GuestProfileScreen } from '@/components/guest-profile';
import { ProfileFooter } from '@/components/profile-footer';
import { ProfilePhotoSheet } from '@/components/profile-photo-sheet';
import { useProfilePhoto } from '@/hooks/use-profile-photo';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { logout } from '@/lib/api';
import { useAuthStatus } from '@/lib/auth-gate';
import { getCommerceProfile, type CommerceProfile } from '@/lib/commerce';
import { useSession } from '@/lib/session';

/**
 * 80dp avatar: real photo when the account has one, else the real initial.
 * The camera button (the only photo control in the app) overlaps the
 * bottom-right edge; during upload it's disabled and a subtle progress veil
 * covers the previous photo — which stays in place until success.
 */
function Avatar({
  name,
  photoURL,
  uploading = false,
  onCameraPress,
}: {
  name: string;
  photoURL: string | null;
  uploading?: boolean;
  onCameraPress?: () => void;
}) {
  const c = useBrandColors();
  const initial = name.trim().charAt(0).toUpperCase() || 'A';
  return (
    <View style={styles.avatarWrap}>
      <View
        accessible
        accessibilityLabel={photoURL ? 'Your profile photo' : `Your account, letter ${initial}`}
        style={[styles.avatar, { backgroundColor: c.backgroundSelected, borderColor: 'rgba(74,143,229,0.45)' }]}
      >
        {photoURL ? (
          <Image source={{ uri: photoURL }} style={styles.avatarImage} contentFit="cover" transition={150} />
        ) : (
          <Text style={[styles.avatarInitial, { color: c.primary }]}>{initial}</Text>
        )}
        {uploading && (
          <View style={styles.avatarVeil} accessibilityLabel="Uploading profile photo">
            <ActivityIndicator color="#FFFFFF" />
          </View>
        )}
      </View>
      {onCameraPress && (
        <Pressable
          onPress={onCameraPress}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel={photoURL ? 'Change profile photo' : 'Add profile photo'}
          hitSlop={8}
          style={({ pressed }) => [
            styles.cameraBtn,
            { backgroundColor: c.primary, borderColor: c.background, opacity: pressed || uploading ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="camera" size={12} color="#04102A" />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Neutral placeholder while Firebase restores the persisted session on cold
 * start. Deliberately shows neither guest copy nor half-loaded account data —
 * flat shapes only, mirroring the real layout so there's no jump on resolve.
 */
function SessionRestoringSkeleton() {
  const c = useBrandColors();
  const block = { backgroundColor: 'rgba(120,150,210,0.10)' };
  return (
    <View style={styles.scroll}>
      <View style={styles.header}>
        <View style={[styles.avatar, block, { borderColor: 'transparent' }]} />
        <View style={styles.headerText}>
          <View style={[skel.line, block, { width: 150, height: 20 }]} />
          <View style={[skel.line, block, { width: 210, height: 12 }]} />
        </View>
      </View>
      <View style={[skel.group, block, { borderColor: c.border }]} />
      <View style={[skel.row, block]} />
    </View>
  );
}

export default function ProfileScreen() {
  const c = useBrandColors();
  const { user } = useSession();
  const status = useAuthStatus();

  const [signingOut, setSigningOut] = useState(false);
  // 'address' and 'payment' both open the commerce sheet (it edits the saved
  // address AND the payment preference — the only payment data we hold; cards
  // themselves live with Razorpay). Tracking which row started the load keeps
  // the spinner on the row that was actually tapped.
  const [sheetLoading, setSheetLoading] = useState<'address' | 'payment' | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [commerce, setCommerce] = useState<CommerceProfile | null>(null);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const { photoURL, uploading, takePhoto, pickFromLibrary, removePhoto } = useProfilePhoto();

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: doSignOut },
    ]);
  }

  async function doSignOut() {
    setSigningOut(true);
    try {
      // Clears the Firebase session + AsyncStorage persistence; the session
      // provider flips to guest and this same route re-renders the guest
      // branch, so Back can never reach the signed-in screen again.
      await logout();
    } catch {
      Alert.alert('Sign-out failed', 'Please check your connection and try again.');
    } finally {
      setSigningOut(false);
    }
  }

  async function openCommerceSheet(source: 'address' | 'payment') {
    if (sheetLoading) return;
    setSheetLoading(source);
    try {
      setCommerce(await getCommerceProfile());
      setDeliveryOpen(true);
    } catch {
      Alert.alert("Couldn't load your details", 'Please check your connection and try again.');
    } finally {
      setSheetLoading(null);
    }
  }

  if (status === 'loading') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <SessionRestoringSkeleton />
      </SafeAreaView>
    );
  }

  if (status === 'guest') {
    return <GuestProfileScreen />;
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Header ─────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Avatar
            name={user?.displayName || user?.email || 'A'}
            photoURL={photoURL}
            uploading={uploading}
            onCameraPress={() => setPhotoSheetOpen(true)}
          />
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: c.text }]}>Your account</Text>
            <Text style={[styles.subtitle, { color: c.textSecondary }]} numberOfLines={2}>
              Manage your preferences and activity
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={6}
            style={({ pressed }) => [
              styles.settingsBtn,
              { backgroundColor: c.cardBackground, borderColor: c.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="settings-outline" size={17} color={c.textSecondary} />
          </Pressable>
        </View>

        {/* ── Account menu — one card per row, per the approved mock ── */}
        <View style={styles.menu}>
          <CardRow
            icon="bag-handle-outline"
            label="Your orders"
            support="Purchases, payments and tracking"
            onPress={() => router.push('/orders')}
          />
          <CardRow
            icon="storefront-outline"
            label="Seller Hub"
            support="Manage your shop on Any&All"
            onPress={() => router.push('/sell')}
          />
          <CardRow
            icon="notifications-outline"
            label="Notifications"
            support="Manage alerts and updates"
            onPress={() => router.push('/notifications')}
          />
          <CardRow
            icon="location-outline"
            label="Saved addresses"
            support="View and manage your delivery addresses"
            onPress={() => openCommerceSheet('address')}
            loading={sheetLoading === 'address'}
          />
          <CardRow
            icon="card-outline"
            label="Payment methods"
            support="Cards and payment options"
            onPress={() => openCommerceSheet('payment')}
            loading={sheetLoading === 'payment'}
          />
          <CardRow
            icon="help-circle-outline"
            label="Help & support"
            support="FAQs, assistant, contact and support tickets"
            onPress={() => router.push('/help')}
          />
        </View>

        <SignOutRow onPress={confirmSignOut} busy={signingOut} />

        <ProfileFooter />
      </ScrollView>

      <GetReadySheet
        visible={deliveryOpen}
        profile={commerce}
        onReady={() => setDeliveryOpen(false)}
        onClose={() => setDeliveryOpen(false)}
      />

      <ProfilePhotoSheet
        visible={photoSheetOpen}
        hasPhoto={!!photoURL}
        onTakePhoto={() => void takePhoto()}
        onPickFromLibrary={() => void pickFromLibrary()}
        onRemove={() => void removePhoto()}
        onClose={() => setPhotoSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    padding: Spacing.three,
    paddingTop: Spacing.four,
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginBottom: Spacing.one,
  },
  menu: { gap: Spacing.two },
  avatarWrap: { width: 66, height: 66 },
  avatar: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4,10,26,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBtn: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 25, fontFamily: Fonts.sansSemiBold },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 19, fontFamily: Fonts.sansSemiBold, letterSpacing: 0.1 },
  subtitle: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17 },
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },

});

const skel = StyleSheet.create({
  line: { borderRadius: 6 },
  group: { height: 230, borderRadius: 16, borderWidth: 1 },
  row: { height: 56, borderRadius: 16 },
});
