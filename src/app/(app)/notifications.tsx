// Notifications centre — reached from the Profile menu.
//
// HONEST STATE: there is no notification feed in the backend yet (no push
// setup, no notifications collection), so a signed-in user truthfully has
// none. This screen is the real destination where they will appear; only the
// list rendering changes when the backend lands.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';

export default function NotificationsScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Notifications</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="notifications-outline"
          title="Sign in to see notifications"
          body="Order updates and show reminders arrive here once you’re signed in."
          reason="profile"
        />
      ) : (
        <View style={styles.empty}>
          <View style={[styles.iconRing, { borderColor: 'rgba(120,150,210,0.24)' }]}>
            <Ionicons name="notifications-outline" size={26} color={c.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: c.text }]}>You’re all caught up</Text>
          <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
            Updates about your orders and reminders for shows you care about will appear here.
          </Text>
        </View>
      )}
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
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { fontSize: 19, fontFamily: Fonts.sansSemiBold },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
    paddingBottom: Spacing.five,
  },
  iconRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  emptyTitle: { fontSize: 18, fontFamily: Fonts.sansSemiBold },
  emptyBody: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 20, textAlign: 'center' },
});
