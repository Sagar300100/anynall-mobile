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
import { requestPasswordReset } from '@/lib/api';

export default function ForgotPasswordScreen() {
  const c = useBrandColors();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset() {
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err: any) {
      setError(err?.message || 'Could not send the reset email. Please try again.');
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
            {sent ? (
              <>
                <View style={styles.headerBlock}>
                  <Eyebrow>Done</Eyebrow>
                  <DisplayText size={40}>Email sent.</DisplayText>
                </View>
                <Text style={[styles.body, { color: c.textSecondary }]}>
                  If an account exists for {email.trim()}, a password-reset link is
                  on its way. Follow it, then sign in with your new password.
                </Text>
              </>
            ) : (
              <>
                <View style={styles.headerBlock}>
                  <Eyebrow>Account recovery</Eyebrow>
                  <DisplayText size={40}>Reset your password.</DisplayText>
                </View>
                <FormError message={error} />
                <Field
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder="you@example.com"
                />
                <PrimaryButton title="Send reset link" onPress={handleReset} loading={busy} />
              </>
            )}

            <Link href="/sign-in" style={[styles.link, { color: c.primary }]}>
              Back to sign in
            </Link>
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
  body: { fontSize: 15, lineHeight: 22, fontFamily: Fonts.sans },
  link: {
    textAlign: 'center',
    fontFamily: Fonts.sansSemiBold,
    fontSize: 15,
  },
});
