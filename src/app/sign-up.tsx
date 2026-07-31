import { Link, router } from 'expo-router';
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
import { register } from '@/lib/api';

export default function SignUpScreen() {
  const c = useBrandColors();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSignUp() {
    setError(null);
    setBusy(true);
    try {
      await register(email.trim(), password, name, username);
      // Account exists but email is unverified, so the auth guard keeps them
      // out of (app) until they verify and sign in.
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Sign-up failed. Please try again.');
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
            {done ? (
              <>
                <View style={styles.headerBlock}>
                  <Eyebrow>One more step</Eyebrow>
                  <DisplayText size={40}>Check your inbox.</DisplayText>
                </View>
                <Text style={[styles.body, { color: c.textSecondary }]}>
                  We sent a verification link to {email.trim()}. Tap it, then come
                  back and sign in.
                </Text>
                <PrimaryButton title="Go to sign in" onPress={() => router.replace('/sign-in')} />
              </>
            ) : (
              <>
                <View style={styles.headerBlock}>
                  <Eyebrow>Live shopping · India</Eyebrow>
                  <DisplayText size={40}>Create your account.</DisplayText>
                </View>

                <FormError message={error} />

                <Field
                  label="Full name (as on your ID)"
                  value={name}
                  onChangeText={setName}
                  autoComplete="name"
                  placeholder="Priya Sharma"
                />
                <Field
                  label="Username"
                  value={username}
                  onChangeText={(v) => setUsername(v.toLowerCase())}
                  autoCapitalize="none"
                  placeholder="priya_finds"
                />
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
                  autoComplete="new-password"
                  placeholder="8+ chars, mixed case, number, symbol"
                />
                <PrimaryButton title="Create account" onPress={handleSignUp} loading={busy} />
                <View style={[styles.divider, { backgroundColor: c.border }]} />
                <Text style={[styles.muted, { color: c.textSecondary }]}>
                  Already have an account?
                </Text>
                <Link href="/sign-in" style={[styles.link, { color: c.primary }]}>
                  Sign in
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
  body: { fontSize: 15, lineHeight: 22, fontFamily: Fonts.sans },
  muted: { textAlign: 'center', fontFamily: Fonts.sans, fontSize: 14 },
  link: {
    textAlign: 'center',
    fontFamily: Fonts.sansSemiBold,
    fontSize: 15,
  },
  divider: { height: 1, alignSelf: 'stretch', marginVertical: Spacing.two },
});
