// Two-factor authentication — mobile port of the website's TwoFactorSection.
// Same Firebase TOTP enrolment, adapted to a phone:
//
// - The site renders a QR code for a *second* device to scan. Here the
//   authenticator app lives on THIS device, so the primary action is an
//   otpauth:// deep link that opens it directly with the account pre-filled —
//   you cannot scan a QR displayed on the screen you're holding. The manual
//   secret stays visible (selectable for long-press copy) for people setting
//   up on another device.
// - Firebase requires a recent sign-in for MFA changes. When it refuses,
//   password accounts get an inline password confirm that re-auths and
//   retries; social-only accounts get the sign-out/sign-in remedy.
//
// Sign-in already handles TOTP challenges (lib/api.ts resolveMfaLogin) — this
// screen supplies the missing enrolment half, and factors enrolled here
// challenge web sign-ins too (same Firebase project).
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Field, FormError, PrimaryButton, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  cancelTotpEnrollment,
  completeTotpEnrollment,
  disableTwoFactor,
  hasPasswordProvider,
  isStaleLoginError,
  isTwoFactorEnrolled,
  listEnrolledFactors,
  reauthWithPassword,
  socialProviderName,
  startTotpEnrollment,
} from '@/lib/account';

type Mode = 'idle' | 'setup';

export default function TwoFactorScreen() {
  const c = useBrandColors();
  const passwordAccount = hasPasswordProvider();

  const [enrolled, setEnrolled] = useState(isTwoFactorEnrolled());
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Enrolment-in-progress data.
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [code, setCode] = useState('');

  // Stale-session recovery: which action to retry after password re-auth.
  const [reauthFor, setReauthFor] = useState<'enroll' | 'disable' | null>(null);
  const [reauthPassword, setReauthPassword] = useState('');

  /** Runs an MFA action; on a stale session, opens the right recovery path. */
  async function guarded(action: 'enroll' | 'disable', run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await run();
    } catch (err) {
      if (isStaleLoginError(err)) {
        if (passwordAccount) {
          setReauthFor(action);
        } else {
          setError(
            `For your security this needs a fresh sign-in. Sign out, sign back in with ${socialProviderName()}, then try again.`
          );
        }
      } else if (err instanceof Error && /invalid.*code/i.test(err.message + ((err as any).code || ''))) {
        setError("That code isn't right. Check your authenticator app and try again.");
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function beginEnroll() {
    await guarded('enroll', async () => {
      const res = await startTotpEnrollment();
      setOtpauthUrl(res.otpauthUrl);
      setSecretKey(res.secretKey);
      setCode('');
      setMode('setup');
    });
  }

  async function verifyEnroll() {
    if (code.trim().length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await completeTotpEnrollment(code.trim());
      setMode('idle');
      setEnrolled(true);
      setOk("Two-factor authentication is on. You'll be asked for a code at each sign-in — on this app and on anynall.com.");
    } catch (err: any) {
      if (err?.code === 'auth/invalid-verification-code' || err?.code === 'auth/invalid-code') {
        setError("That code isn't right. Check your authenticator app and try again.");
      } else {
        setError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function confirmTurnOff() {
    Alert.alert(
      'Turn off two-factor authentication?',
      'Your account will be protected by your password alone.',
      [
        { text: 'Keep it on', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: turnOff },
      ]
    );
  }

  async function turnOff() {
    await guarded('disable', async () => {
      for (const f of listEnrolledFactors()) await disableTwoFactor(f.uid);
      setEnrolled(false);
      setOk('Two-factor authentication has been turned off.');
    });
  }

  async function submitReauth() {
    if (!reauthPassword || !reauthFor) return;
    const action = reauthFor;
    setBusy(true);
    setError(null);
    try {
      await reauthWithPassword(reauthPassword);
      setReauthFor(null);
      setReauthPassword('');
      // Session is fresh now — run the original action.
      if (action === 'enroll') await beginEnroll();
      else await turnOff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify your password.');
    } finally {
      setBusy(false);
    }
  }

  function leaveSetup() {
    cancelTotpEnrollment();
    setMode('idle');
    setError(null);
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
        <Text style={[styles.topTitle, { color: c.text }]}>Two-factor authentication</Text>
        {enrolled && (
          <View style={[styles.onBadge, { borderColor: 'rgba(74,222,128,0.4)' }]}>
            <Text style={styles.onBadgeText}>ON</Text>
          </View>
        )}
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
          <Text style={[styles.body, { color: c.textSecondary }]}>
            Add a second step at sign-in using a free authenticator app (Google Authenticator,
            Authy, 1Password). Even if someone gets your password, they can’t get in without your
            phone.
          </Text>

          {!!ok && (
            <View style={[styles.okBox, { borderColor: 'rgba(74,222,128,0.35)' }]}>
              <Ionicons name="shield-checkmark-outline" size={16} color="#4ade80" />
              <Text style={[styles.okText, { color: '#4ade80' }]}>{ok}</Text>
            </View>
          )}
          <FormError message={error} />

          {/* ── Stale-session recovery (password accounts) ── */}
          {reauthFor && (
            <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.borderStrong }]}>
              <Text style={[styles.cardTitle, { color: c.text }]}>Confirm it’s you</Text>
              <Text style={[styles.body, { color: c.textSecondary }]}>
                Security changes need a fresh check — enter your password to continue.
              </Text>
              <Field
                label="Password"
                value={reauthPassword}
                onChangeText={setReauthPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                leftIcon="lock-closed-outline"
              />
              <PrimaryButton
                title="Confirm"
                onPress={submitReauth}
                loading={busy}
                disabled={!reauthPassword}
              />
            </View>
          )}

          {/* ── Idle states ── */}
          {mode === 'idle' && !reauthFor && (
            <View style={styles.actions}>
              {enrolled ? (
                <>
                  {listEnrolledFactors().map((f) => (
                    <View
                      key={f.uid}
                      style={[styles.factorRow, { backgroundColor: c.cardBackground, borderColor: c.border }]}
                    >
                      <Ionicons name="shield-checkmark" size={18} color="#4ade80" />
                      <Text style={[styles.factorLabel, { color: c.text }]}>{f.label}</Text>
                    </View>
                  ))}
                  <PrimaryButton title="Turn off 2FA" variant="ghost" onPress={confirmTurnOff} loading={busy} />
                </>
              ) : (
                <PrimaryButton title="Enable 2FA" onPress={beginEnroll} loading={busy} />
              )}
            </View>
          )}

          {/* ── Setup flow ── */}
          {mode === 'setup' && (
            <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              <Text style={[styles.cardTitle, { color: c.text }]}>Set up your authenticator</Text>

              <View style={styles.step}>
                <StepDot n={1} />
                <Text style={[styles.body, styles.stepText, { color: c.textSecondary }]}>
                  Add Any&All to your authenticator app:
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  Linking.openURL(otpauthUrl).catch(() =>
                    setError(
                      'No authenticator app answered. Install one (e.g. Google Authenticator), or add the key below manually.'
                    )
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel="Open authenticator app"
                style={({ pressed }) => [
                  styles.openBtn,
                  { backgroundColor: c.cta, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Ionicons name="open-outline" size={16} color={c.ctaText} />
                <Text style={[styles.openBtnText, { color: c.ctaText }]}>
                  Open authenticator app
                </Text>
              </Pressable>

              <Text style={[styles.keyLabel, { color: c.textFaint }]}>
                Setting up on another device? Enter this key there (long-press to copy):
              </Text>
              <Text
                selectable
                style={[styles.secret, { color: c.text, backgroundColor: c.backgroundElement, borderColor: c.border }]}
              >
                {secretKey}
              </Text>

              <View style={styles.step}>
                <StepDot n={2} />
                <Text style={[styles.body, styles.stepText, { color: c.textSecondary }]}>
                  Type the 6-digit code it shows to confirm:
                </Text>
              </View>
              <TextInput
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                placeholder="000000"
                placeholderTextColor={c.textFaint}
                accessibilityLabel="6-digit verification code"
                style={[
                  styles.codeInput,
                  { backgroundColor: c.backgroundElement, borderColor: c.border, color: c.text },
                ]}
              />

              <PrimaryButton
                title="Verify & turn on"
                onPress={verifyEnroll}
                loading={busy}
                disabled={code.trim().length !== 6}
              />
              <Pressable
                onPress={leaveSetup}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Cancel setup"
                style={({ pressed }) => [styles.cancel, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.cancelText, { color: c.textSecondary }]}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StepDot({ n }: { n: number }) {
  const c = useBrandColors();
  return (
    <View style={[dotStyles.dot, { backgroundColor: 'rgba(46,107,255,0.14)' }]}>
      <Text style={[dotStyles.dotText, { color: c.primary }]}>{n}</Text>
    </View>
  );
}

const dotStyles = StyleSheet.create({
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: 12, fontFamily: Fonts.sansSemiBold },
});

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
  topTitle: { flex: 1, fontSize: 18, fontFamily: Fonts.sansSemiBold },
  onBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  onBadgeText: { fontSize: 10.5, fontFamily: Fonts.sansSemiBold, color: '#4ade80' },

  scroll: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.three },
  body: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 21 },

  okBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    backgroundColor: 'rgba(74,222,128,0.08)',
  },
  okText: { flex: 1, fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },

  actions: { gap: Spacing.two },
  factorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
  },
  factorLabel: { flex: 1, fontSize: 14.5, fontFamily: Fonts.sansMedium },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three + Spacing.one, gap: Spacing.two + Spacing.one },
  cardTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepText: { flex: 1 },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    minHeight: 46,
  },
  openBtnText: { fontSize: 14, fontFamily: Fonts.sansMedium },
  keyLabel: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 17 },
  secret: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 19,
    borderWidth: 1,
    borderRadius: 10,
    padding: Spacing.three,
  },
  codeInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    fontSize: 22,
    fontFamily: Fonts.mono,
    textAlign: 'center',
    letterSpacing: 10,
  },
  cancel: { alignSelf: 'center', paddingVertical: Spacing.one, minHeight: 40, justifyContent: 'center' },
  cancelText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
});
