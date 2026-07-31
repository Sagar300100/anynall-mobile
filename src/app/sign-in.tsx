import { Link } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DisplayText,
  Eyebrow,
  Field,
  FormError,
  PrimaryButton,
  useBrandColors,
} from '@/components/ui/form';
import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { login, resolveMfaLogin } from '@/lib/api';

export default function SignInScreen() {
  const c = useBrandColors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Success needs no navigation: SessionProvider sees the signed-in user and
  // the root Stack.Protected guard swaps to the (app) group automatically.
  async function handleSignIn() {
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      if (err?.code === 'MFA_REQUIRED') {
        setMfaStep(true);
      } else {
        setError(err?.message || 'Sign-in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleMfa() {
    setError(null);
    setBusy(true);
    try {
      await resolveMfaLogin(mfaCode);
    } catch (err: any) {
      setError(err?.message || 'Invalid code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <View style={styles.headerBlock}>
              <Eyebrow>Live shopping · India</Eyebrow>
              <DisplayText size={40}>
                {mfaStep ? 'Two-factor code.' : 'Welcome back.'}
              </DisplayText>
            </View>

            <FormError message={error} />

            {mfaStep ? (
              <>
                <Field
                  label="6-digit code from your authenticator app"
                  value={mfaCode}
                  onChangeText={setMfaCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
                <PrimaryButton title="Verify" onPress={handleMfa} loading={busy} />
              </>
            ) : (
              <>
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder="you@example.com"
                />
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="password"
                  placeholder="••••••••"
                />
                <PrimaryButton title="Sign in" onPress={handleSignIn} loading={busy} />
                <Link href="/forgot-password" style={[styles.link, { color: c.primary }]}>
                  Forgot password?
                </Link>
                <View style={[styles.divider, { backgroundColor: c.border }]} />
                <Text style={[styles.muted, { color: c.textSecondary }]}>
                  New to Any &amp; All?
                </Text>
                <Link href="/sign-up" style={[styles.link, { color: c.primary }]}>
                  Create an account
                </Link>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.four },
  card: {
    gap: Spacing.three,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth / 2,
  },
  headerBlock: { gap: Spacing.two, marginBottom: Spacing.two },
  muted: { textAlign: 'center', fontFamily: Fonts.sans, fontSize: 14 },
  link: {
    textAlign: 'center',
    fontFamily: Fonts.sansSemiBold,
    fontSize: 15,
  },
  divider: { height: 1, alignSelf: 'stretch', marginVertical: Spacing.two },
});
