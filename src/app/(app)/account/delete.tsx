// Delete account — mobile port of the website's danger-zone flow
// (AccountSettingsPage.tsx handleDeleteAccount + DeleteAccountModal) against
// POST /api/account/delete.
//
// Same double confirmation as the web: type DELETE, and prove identity
// (password re-auth for password accounts; recent sign-in for social ones).
// The server then cascades the full erasure — shows, usernames, follows, DM
// threads, KYC identity hashes, the user document — and removes the Auth
// record last, so a partial failure never leaves a half-deleted account. On
// success the local session is signed out and the app lands back on Live.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Field, FormError, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  deleteAccount,
  hasPasswordProvider,
  isRecentAuthError,
  socialProviderName,
} from '@/lib/account';

const DANGER = '#E5484D';

const ERASED: { icon: string; label: string }[] = [
  { icon: 'person-outline', label: 'Your profile, username and KYC records' },
  { icon: 'videocam-outline', label: 'Your shows and their chat history' },
  { icon: 'people-outline', label: 'Followers and accounts you follow' },
  { icon: 'chatbubbles-outline', label: 'Your message threads' },
];

export default function DeleteAccountScreen() {
  const c = useBrandColors();
  const passwordAccount = hasPasswordProvider();

  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmed = confirmText.trim().toUpperCase() === 'DELETE';
  const ready = confirmed && (!passwordAccount || !!password);

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(passwordAccount ? password : null);
      // Everything is gone and the session is signed out — leave the account
      // area entirely. Live is the app's public home.
      router.replace('/');
    } catch (err) {
      if (isRecentAuthError(err)) {
        setError(
          passwordAccount
            ? 'Please re-enter your password and try again.'
            : `For your security this needs a fresh sign-in. Sign out, sign back in with ${socialProviderName()}, then delete your account within 5 minutes.`
        );
      } else {
        setError(err instanceof Error ? err.message : 'Could not delete your account. Please try again.');
      }
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Delete account</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.warnBox, { borderColor: 'rgba(229,72,77,0.35)' }]}>
            <Ionicons name="warning-outline" size={18} color={DANGER} />
            <Text style={[styles.warnText, { color: c.text }]}>
              This is permanent. There is no undo, and no recovery period.
            </Text>
          </View>

          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
            DELETED IMMEDIATELY
          </Text>
          <View style={[styles.list, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            {ERASED.map((item, i) => (
              <View key={item.label}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                <View style={styles.listRow}>
                  <Ionicons name={item.icon as never} size={18} color={c.textSecondary} />
                  <Text style={[styles.listText, { color: c.textSecondary }]}>{item.label}</Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={[styles.note, { color: c.textFaint }]}>
            Records we’re legally required to keep (e.g. tax records of completed orders) are
            retained as described in the Privacy Policy.
          </Text>

          <Field
            label='Type DELETE to confirm'
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="DELETE"
          />
          {passwordAccount ? (
            <Field
              label="Your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              leftIcon="lock-closed-outline"
            />
          ) : (
            <Text style={[styles.note, { color: c.textFaint }]}>
              You’re signed in with {socialProviderName()}. If deletion is refused for security,
              sign out, sign back in, and retry within 5 minutes.
            </Text>
          )}

          <FormError message={error} />

          <Pressable
            onPress={submit}
            disabled={!ready || busy}
            accessibilityRole="button"
            accessibilityLabel="Delete my account forever"
            accessibilityState={{ disabled: !ready || busy }}
            style={({ pressed }) => [
              styles.deleteBtn,
              {
                backgroundColor: ready ? DANGER : 'rgba(229,72,77,0.25)',
                opacity: pressed || busy ? 0.75 : 1,
              },
            ]}
          >
            <Text style={[styles.deleteBtnText, { color: ready ? '#fff' : 'rgba(255,255,255,0.55)' }]}>
              {busy ? 'Deleting…' : 'Delete my account forever'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [styles.cancel, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.cancelText, { color: c.textSecondary }]}>Keep my account</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.sansSemiBold },
  scroll: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.three },

  warnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    backgroundColor: 'rgba(229,72,77,0.08)',
  },
  warnText: { flex: 1, fontSize: 13.5, fontFamily: Fonts.sansMedium, lineHeight: 19 },

  sectionLabel: {
    fontSize: 11.5,
    fontFamily: Fonts.sansMedium,
    letterSpacing: 1.1,
    marginLeft: 4,
    marginBottom: -Spacing.two,
  },
  list: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    minHeight: 46,
  },
  listText: { flex: 1, fontSize: 13.5, fontFamily: Fonts.sans },
  note: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },

  deleteBtn: {
    borderRadius: 6,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  cancel: { alignSelf: 'center', paddingVertical: Spacing.one, minHeight: 44, justifyContent: 'center' },
  cancelText: { fontSize: 14, fontFamily: Fonts.sansMedium },
});
