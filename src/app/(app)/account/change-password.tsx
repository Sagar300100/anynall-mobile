// Change password — the REAL version of the website's ChangePasswordModal
// (which is an unwired shell): re-auth with the current password, then update
// in place. The email-reset-link path stays available underneath for anyone
// who can't remember the current one.
//
// Password rules mirror the Firebase policy the backend enforces (8+ chars,
// upper, lower, number, special) — checked client-side first so the user gets
// one clear message instead of a server round trip.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { GradientCTA } from '@/components/brand/gradient-cta';
import { Field, FormError, useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { changePassword, hasPasswordProvider, socialProviderName } from '@/lib/account';
import { requestPasswordReset } from '@/lib/api';
import { useSession } from '@/lib/session';

function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Z]/.test(pw)) return 'Include an uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Include a lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Include a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Include a special character (e.g. ! @ # $).';
  return null;
}

export default function ChangePasswordScreen() {
  const c = useBrandColors();
  const { user } = useSession();
  const passwordAccount = hasPasswordProvider();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nextError, setNextError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  async function submit() {
    setNextError(null);
    setConfirmError(null);
    setError(null);
    const problem = passwordProblem(next);
    if (problem) {
      setNextError(problem);
      return;
    }
    if (confirm !== next) {
      setConfirmError('Passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setDoneMsg('Your password has been changed. Use the new one from your next sign-in.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  }

  function sendResetLink() {
    const email = user?.email;
    if (!email) return;
    Alert.alert('Reset by email', `We’ll email a password-reset link to ${email}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send link',
        onPress: async () => {
          setSendingReset(true);
          try {
            await requestPasswordReset(email);
            Alert.alert('Email sent', 'Check your inbox for the reset link.');
          } catch {
            Alert.alert("Couldn't send the email", 'Please try again in a moment.');
          } finally {
            setSendingReset(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <PressScale
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </PressScale>
        <Text style={[styles.topTitle, { color: c.text }]}>Change password</Text>
      </View>

      {doneMsg ? (
        <View style={styles.done}>
          <View style={[styles.doneRing, { borderColor: 'rgba(74,222,128,0.4)' }]}>
            <Ionicons name="checkmark" size={28} color="#4ade80" />
          </View>
          <Text style={[styles.doneTitle, { color: c.text }]}>Password changed</Text>
          <Text style={[styles.body, styles.doneBody, { color: c.textSecondary }]}>{doneMsg}</Text>
          <View style={styles.doneBtn}>
            <GradientCTA title="Done" onPress={() => router.replace('/settings')} />
          </View>
        </View>
      ) : !passwordAccount ? (
        <View style={styles.done}>
          <View style={[styles.doneRing, { borderColor: 'rgba(120,150,210,0.24)' }]}>
            <Ionicons name="key-outline" size={24} color={c.primary} />
          </View>
          <Text style={[styles.doneTitle, { color: c.text }]}>No password on this account</Text>
          <Text style={[styles.body, styles.doneBody, { color: c.textSecondary }]}>
            You sign in with {socialProviderName()}, so there’s no Any&All password to change —
            your {socialProviderName()} account handles security.
          </Text>
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
            <Field
              label="Current password"
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              leftIcon="lock-closed-outline"
            />
            <Field
              label="New password"
              value={next}
              onChangeText={setNext}
              error={nextError}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              leftIcon="key-outline"
            />
            <Field
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              error={confirmError}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              leftIcon="key-outline"
            />
            <Text style={[styles.hint, { color: c.textFaint }]}>
              At least 8 characters, with an uppercase letter, a lowercase letter, a number and a
              special character.
            </Text>
            <FormError message={error} />
            <GradientCTA
              title={busy ? 'Changing…' : 'Change password'}
              onPress={submit}
              disabled={busy || !current || !next || !confirm}
            />
            <PressScale
              onPress={sendResetLink}
              disabled={sendingReset}
              accessibilityRole="button"
              accessibilityLabel="Forgot your current password? Reset by email"
              style={styles.resetLink}
            >
              <Text style={[styles.resetText, { color: c.primary }]}>
                {sendingReset ? 'Sending…' : 'Forgot it? Reset by email instead'}
              </Text>
            </PressScale>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
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
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  scroll: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.three },
  body: { fontSize: 14, fontFamily: Fonts.ui, lineHeight: 21 },
  hint: { fontSize: 12.5, fontFamily: Fonts.ui, lineHeight: 18, marginTop: -Spacing.two },
  resetLink: { alignSelf: 'center', paddingVertical: Spacing.two, minHeight: 44, justifyContent: 'center' },
  resetText: { fontSize: 13.5, fontFamily: Fonts.uiMedium },

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
  doneTitle: { fontSize: 20, fontFamily: Fonts.displayMedium, letterSpacing: -0.5, textAlign: 'center' },
  doneBody: { textAlign: 'center', maxWidth: 330 },
  doneBtn: { alignSelf: 'stretch', maxWidth: 340, marginTop: Spacing.three },
});
