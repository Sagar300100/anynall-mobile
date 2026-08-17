// Settings — reached from the gear on the Profile tab.
//
// Deliberately thin: it contains only settings that actually exist today.
// Account email (with its real verification state) and a real password-reset
// action that sends Firebase's reset email. No fake toggles, no placeholder
// preferences — new sections get added here when their backends land.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuGroup, MenuRow } from '@/components/account-menu';
import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { requestPasswordReset } from '@/lib/api';
import { useAuthStatus } from '@/lib/auth-gate';
import { useSession } from '@/lib/session';

export default function SettingsScreen() {
  const c = useBrandColors();
  const { user } = useSession();
  const status = useAuthStatus();
  const [sending, setSending] = useState(false);

  function confirmPasswordReset() {
    const email = user?.email;
    if (!email) return;
    Alert.alert('Change password', `We’ll email a password-reset link to ${email}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send link',
        onPress: async () => {
          setSending(true);
          try {
            await requestPasswordReset(email);
            Alert.alert('Email sent', 'Check your inbox for the reset link.');
          } catch {
            Alert.alert("Couldn't send the email", 'Please try again in a moment.');
          } finally {
            setSending(false);
          }
        },
      },
    ]);
  }

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
        <Text style={[styles.topTitle, { color: c.text }]}>Settings</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="settings-outline"
          title="Sign in to manage settings"
          body="Account settings become available once you’re signed in."
          reason="profile"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>ACCOUNT</Text>
          <MenuGroup>
            {/* Informational row — not a button, so no chevron and no press state. */}
            <View style={styles.infoRow} accessible accessibilityLabel={`Email, ${user?.email ?? ''}`}>
              <Ionicons name="mail-outline" size={22} color={c.primary} />
              <View style={styles.infoText}>
                <Text style={[styles.infoLabel, { color: c.text }]}>Email</Text>
                <Text style={[styles.infoValue, { color: c.textSecondary }]} numberOfLines={1}>
                  {user?.email}
                </Text>
              </View>
              {user?.emailVerified && (
                <View style={[styles.badge, { borderColor: 'rgba(74,143,229,0.4)' }]}>
                  <Text style={[styles.badgeText, { color: c.primary }]}>Verified</Text>
                </View>
              )}
            </View>
            <MenuRow
              icon="key-outline"
              label="Change password"
              support="We’ll email you a secure reset link"
              onPress={confirmPasswordReset}
              loading={sending}
            />
          </MenuGroup>
        </ScrollView>
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
  scroll: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two },
  sectionLabel: { fontSize: 11.5, fontFamily: Fonts.sansMedium, letterSpacing: 1.1, marginLeft: 4 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    minHeight: 56,
  },
  infoText: { flex: 1, gap: 1 },
  infoLabel: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  infoValue: { fontSize: 12.5, fontFamily: Fonts.sans },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontFamily: Fonts.sansMedium },
});
