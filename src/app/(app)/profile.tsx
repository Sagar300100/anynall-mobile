import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DisplayText,
  Eyebrow,
  FormError,
  PrimaryButton,
  useBrandColors,
} from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { logout } from '@/lib/api';
import { useSession } from '@/lib/session';

function MenuRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  onPress?: () => void;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: c.border, backgroundColor: c.cardBackground, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
        <Ionicons name={icon} size={18} color={c.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: c.text }]}>{label}</Text>
        {!!hint && <Text style={[styles.rowHint, { color: c.textSecondary }]}>{hint}</Text>}
      </View>
      {onPress && <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const c = useBrandColors();
  const { user } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setError(null);
    setBusy(true);
    try {
      await logout();
      // Guard flips to the sign-in stack automatically.
    } catch {
      setError('Sign-out failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.content}>
        <View style={styles.headerBlock}>
          <Eyebrow>Your account</Eyebrow>
          <DisplayText size={30}>
            {user?.displayName ? `${user.displayName}.` : 'Profile.'}
          </DisplayText>
          <Text style={[styles.email, { color: c.textSecondary }]}>{user?.email}</Text>
        </View>

        <View style={styles.menu}>
          <MenuRow
            icon="bag-handle-outline"
            label="Your orders"
            hint="Purchases, payments, tracking"
            onPress={() => router.push('/orders')}
          />
          <MenuRow
            icon="storefront-outline"
            label="Seller Hub"
            hint="Manage your shop on anynall.com"
            onPress={() => WebBrowser.openBrowserAsync('https://anynall.com')}
          />
          <MenuRow
            icon="notifications-outline"
            label="Notifications"
            hint="Arrives with the app build"
          />
          <MenuRow
            icon="help-buoy-outline"
            label="Help & support"
            hint="FAQs and tickets on anynall.com"
            onPress={() => WebBrowser.openBrowserAsync('https://anynall.com/help')}
          />
        </View>

        <FormError message={error} />
        <PrimaryButton title="Sign out" onPress={handleSignOut} loading={busy} variant="ghost" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, padding: Spacing.three, gap: Spacing.four },
  headerBlock: { gap: Spacing.one + 2, paddingTop: Spacing.two },
  email: { fontSize: 14, fontFamily: Fonts.sans },
  menu: { gap: Spacing.two + Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 1 },
  rowLabel: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  rowHint: { fontSize: 12, fontFamily: Fonts.sans },
});
