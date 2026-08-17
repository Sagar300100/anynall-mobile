// Change email — the REAL version of the website's ChangeEmailModal (which is
// an unwired shell). Re-auth with the current password, then Firebase mails a
// verification link to the NEW address; the account only switches once that
// link is opened, so a typo can never lock the user out.
//
// Google/Apple-only accounts have no password and their email comes from the
// provider — the screen says so honestly instead of showing a form that
// cannot work.
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
import { changeEmail, hasPasswordProvider, socialProviderName } from '@/lib/account';
import { useSession } from '@/lib/session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ChangeEmailScreen() {
  const c = useBrandColors();
  const { user } = useSession();
  const passwordAccount = hasPasswordProvider();

  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit() {
    const clean = newEmail.trim().toLowerCase();
    setFieldError(null);
    setError(null);
    if (!EMAIL_RE.test(clean)) {
      setFieldError('Enter a valid email address.');
      return;
    }
    if (clean === (user?.email || '').toLowerCase()) {
      setFieldError('That is already your email address.');
      return;
    }
    setBusy(true);
    try {
      await changeEmail(clean, password);
      setSentTo(clean);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change your email.');
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
        <Text style={[styles.topTitle, { color: c.text }]}>Change email</Text>
      </View>

      {sentTo ? (
        <View style={styles.done}>
          <View style={[styles.doneRing, { borderColor: 'rgba(74,222,128,0.4)' }]}>
            <Ionicons name="mail-unread-outline" size={26} color="#4ade80" />
          </View>
          <Text style={[styles.doneTitle, { color: c.text }]}>Check {sentTo}</Text>
          <Text style={[styles.body, styles.doneBody, { color: c.textSecondary }]}>
            We’ve sent a verification link there. Your email switches over the moment you open it —
            until then, {user?.email} keeps working, so nothing breaks if the address was mistyped.
          </Text>
          <View style={styles.doneBtn}>
            <PrimaryButton title="Done" onPress={() => router.replace('/settings')} />
          </View>
        </View>
      ) : !passwordAccount ? (
        <View style={styles.done}>
          <View style={[styles.doneRing, { borderColor: 'rgba(120,150,210,0.24)' }]}>
            <Ionicons name="logo-google" size={24} color={c.primary} />
          </View>
          <Text style={[styles.doneTitle, { color: c.text }]}>
            Your email comes from {socialProviderName()}
          </Text>
          <Text style={[styles.body, styles.doneBody, { color: c.textSecondary }]}>
            You signed up with {socialProviderName()}, so your Any&All email always matches that
            account. To use a different address, change it with {socialProviderName()} — it updates
            here automatically on your next sign-in.
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
            <Text style={[styles.body, { color: c.textSecondary }]}>
              Signed in as <Text style={{ color: c.text }}>{user?.email}</Text>. We’ll send a
              verification link to the new address — nothing changes until it’s opened.
            </Text>
            <Field
              label="New email address"
              value={newEmail}
              onChangeText={setNewEmail}
              error={fieldError}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              leftIcon="mail-outline"
            />
            <Field
              label="Current password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              leftIcon="lock-closed-outline"
            />
            <FormError message={error} />
            <PrimaryButton
              title="Send verification link"
              onPress={submit}
              loading={busy}
              disabled={!newEmail.trim() || !password}
            />
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
