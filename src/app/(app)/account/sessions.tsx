// Sign out everywhere — mobile port of the website's "Revoke all sessions"
// (pages/AccountSettingsPage.tsx security section) against the recent-auth-
// guarded POST /api/auth/revoke-sessions.
//
// Password accounts confirm with their password up front (that re-auth is
// precisely what satisfies the server's 5-minute freshness window). Social
// accounts have nothing to type — the button calls directly, and a stale
// session gets the honest sign-out/sign-in remedy.
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

import { Field, FormError, PrimaryButton, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  hasPasswordProvider,
  isRecentAuthError,
  reauthWithPassword,
  revokeAllSessions,
  socialProviderName,
} from '@/lib/account';

export default function SessionsScreen() {
  const c = useBrandColors();
  const passwordAccount = hasPasswordProvider();

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      if (passwordAccount) await reauthWithPassword(password);
      await revokeAllSessions();
      setDone(true);
    } catch (err) {
      if (isRecentAuthError(err)) {
        setError(
          passwordAccount
            ? 'Please re-enter your password and try again.'
            : `For your security this needs a fresh sign-in. Sign out, sign back in with ${socialProviderName()}, then try again.`
        );
      } else {
        setError(err instanceof Error ? err.message : 'Could not sign out other devices.');
      }
    } finally {
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
        <Text style={[styles.topTitle, { color: c.text }]}>Sign out everywhere</Text>
      </View>

      {done ? (
        <View style={styles.done}>
          <View style={[styles.doneRing, { borderColor: 'rgba(74,222,128,0.4)' }]}>
            <Ionicons name="shield-checkmark-outline" size={26} color="#4ade80" />
          </View>
          <Text style={[styles.doneTitle, { color: c.text }]}>Other devices signed out</Text>
          <Text style={[styles.body, styles.doneBody, { color: c.textSecondary }]}>
            Every other session has been revoked — those devices lose access within the hour as
            their tokens expire. This device stays signed in.
          </Text>
          <View style={styles.doneBtn}>
            <PrimaryButton title="Done" onPress={() => router.replace('/settings')} />
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.body, { color: c.textSecondary }]}>
              Use this if you signed in on a shared or lost device, or think someone else has your
              password. Every session except this one is revoked; other devices are signed out as
              their tokens expire (within the hour).
            </Text>
            {passwordAccount ? (
              <Field
                label="Confirm your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                leftIcon="lock-closed-outline"
              />
            ) : (
              <Text style={[styles.body, { color: c.textFaint }]}>
                You’re signed in with {socialProviderName()} — no password needed here.
              </Text>
            )}
            <FormError message={error} />
            <PrimaryButton
              title="Sign out other devices"
              onPress={revoke}
              loading={busy}
              disabled={passwordAccount && !password}
            />
            {passwordAccount && (
              <Text style={[styles.hint, { color: c.textFaint }]}>
                If your password may be compromised, change it first — otherwise the other device
                can simply sign back in.
              </Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
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
  body: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 21 },
  hint: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },

  done: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  doneRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  doneTitle: { fontSize: 18, fontFamily: Fonts.sansSemiBold, textAlign: 'center' },
  doneBody: { textAlign: 'center', maxWidth: 330 },
  doneBtn: { alignSelf: 'stretch', maxWidth: 340, marginTop: Spacing.three },
});
