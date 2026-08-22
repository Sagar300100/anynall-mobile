// Create Account — mirrors the redesigned sign-in surface. Keeps the existing
// register() flow (Firebase account → displayName → atomic server-side
// username claim → verification email) and layers on: inline validation,
// debounced username availability, a password-policy strength meter, and the
// shared social buttons. The auth guard keeps unverified accounts out of
// (app), so success lands on the "check your inbox" step, with resend.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AuthBrandHeader,
  GradientCTA,
  GradientWord,
  HeadingText,
  SocialAuthButtons,
} from '@/components/auth-ui';
import { Field, FormError, useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  usernameProblem,
  useUsernameAvailability,
  USERNAME_HELPER,
  USERNAME_RE,
} from '@/hooks/use-username-availability';
import { register } from '@/lib/api';
import { useReturnAfterAuth } from '@/lib/auth-gate';
import { auth } from '@/lib/firebase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Matches the enforced Firebase password policy (see friendlyAuthError). */
function passwordChecks(pw: string) {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
}

function strengthOf(pw: string): { label: 'Weak' | 'Fair' | 'Strong'; score: 1 | 2 | 3 } {
  const c = passwordChecks(pw);
  const met = Object.values(c).filter(Boolean).length;
  if (met >= 5 && pw.length >= 10) return { label: 'Strong', score: 3 };
  if (met >= 4) return { label: 'Fair', score: 2 };
  return { label: 'Weak', score: 1 };
}

export default function SignUpScreen() {
  // Sign-up leaves the account unverified, so the session stays signed-out and
  // this is a no-op until the user verifies and signs in — the "check your
  // inbox" step below is the real end of this flow.
  useReturnAfterAuth();
  const c = useBrandColors();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    username?: string;
    email?: string;
    password?: string;
  }>({});
  const availability = useUsernameAvailability(username);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [socialBusy, setSocialBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const usernameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  // Resend cooldown tick.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function validate(): 'name' | 'username' | 'email' | 'password' | null {
    const errs: typeof fieldErrors = {};
    const cleanName = name.trim();
    if (!cleanName) errs.name = 'Enter your full name.';
    else if (cleanName.length < 2 || !/\p{L}/u.test(cleanName))
      errs.name = 'Enter your real name (letters, at least 2 characters).';

    const cleanUser = username.trim();
    if (!cleanUser) errs.username = 'Pick a username.';
    else if (!USERNAME_RE.test(cleanUser))
      errs.username = USERNAME_HELPER;
    else if (availability === 'taken') errs.username = 'That username is already taken.';
    else if (availability === 'reserved') errs.username = 'That username is reserved.';

    const cleanEmail = email.trim();
    if (!cleanEmail) errs.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(cleanEmail)) errs.email = 'Enter a valid email address.';

    const pw = passwordChecks(password);
    if (!password) errs.password = 'Create a password.';
    else if (!(pw.length && pw.upper && pw.lower && pw.number && pw.symbol))
      errs.password = 'Password doesn’t meet the requirements below.';

    setFieldErrors(errs);
    return (['name', 'username', 'email', 'password'] as const).find((k) => errs[k]) ?? null;
  }

  async function handleSignUp() {
    if (busy || socialBusy) return;
    setError(null);
    const firstInvalid = validate();
    if (firstInvalid) {
      // Focus the first invalid field so the fix is one tap away.
      if (firstInvalid === 'username') usernameRef.current?.focus();
      else if (firstInvalid === 'email') emailRef.current?.focus();
      else if (firstInvalid === 'password') passwordRef.current?.focus();
      return;
    }
    if (availability === 'checking') {
      setError('Hold on — still checking your username.');
      return;
    }
    Keyboard.dismiss();
    setBusy(true);
    try {
      await register(email.trim(), password, name.trim(), username.trim());
      setDone(true);
      setResendIn(30);
    } catch (err: any) {
      setError(err?.message || 'Sign-up failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (resendIn > 0) return;
    try {
      const { sendEmailVerification } = require('firebase/auth');
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser, { url: 'https://anynall.com/auth/action' });
        setResendIn(30);
      }
    } catch {
      setError('Could not resend just now — try again in a minute.');
    }
  }

  const checks = passwordChecks(password);
  const strength = strengthOf(password);
  const showRequirements = passwordFocused || !!fieldErrors.password;

  const availabilityLine = (() => {
    switch (availability) {
      case 'checking':
        return { text: 'Checking availability…', color: c.textSecondary };
      case 'available':
        return { text: 'Username is available.', color: Brand.successSoft };
      case 'taken':
        return { text: 'Username is already taken.', color: c.danger };
      case 'reserved':
        return { text: 'That username is reserved.', color: c.danger };
      case 'invalid':
        return { text: usernameProblem(username) ?? USERNAME_HELPER, color: c.danger };
      case 'unknown':
        return { text: "Couldn't check right now — we'll confirm at signup.", color: c.textSecondary };
      default:
        return { text: 'This will be your unique profile name.', color: c.textSecondary };
    }
  })();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            {done ? (
              <>
                <AuthBrandHeader />
                <View style={styles.headingBlock}>
                  <HeadingText>Check your</HeadingText>
                  <GradientWord>inbox!</GradientWord>
                  <Text style={[styles.sub, { color: c.textSecondary }]}>
                    We sent a verification link to {email.trim()}. Tap it, then come back and
                    sign in.
                  </Text>
                </View>
                <FormError message={error} />
                <GradientCTA title="Go to sign in" onPress={() => router.replace('/sign-in')} />
                <Pressable
                  onPress={handleResend}
                  disabled={resendIn > 0}
                  accessibilityRole="button"
                  accessibilityLabel="Resend verification email"
                  hitSlop={8}
                  style={styles.resend}
                >
                  <Text
                    style={{
                      color: resendIn > 0 ? c.textFaint : c.primary,
                      fontFamily: Fonts.sansMedium,
                      fontSize: 14,
                    }}
                  >
                    {resendIn > 0 ? `Resend email (${resendIn}s)` : 'Resend email'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                {/* Top bar: back + sign-in shortcut */}
                <View style={styles.topBar}>
                  <Pressable
                    onPress={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                    hitSlop={10}
                    style={styles.backBtn}
                  >
                    <Ionicons name="chevron-back" size={24} color={c.text} />
                  </Pressable>
                  <View style={styles.topRight}>
                    <Text style={[styles.topRightMuted, { color: c.textSecondary }]}>
                      Already have an account?{' '}
                    </Text>
                    <Link href="/sign-in" style={[styles.topRightLink, { color: c.primary }]}>
                      Sign in
                    </Link>
                  </View>
                </View>

                <AuthBrandHeader />

                <View style={styles.headingBlock}>
                  <HeadingText>Create your</HeadingText>
                  <GradientWord>account.</GradientWord>
                  <Text style={[styles.sub, { color: c.textSecondary }]}>
                    Join Any&All and start your live shopping journey.
                  </Text>
                </View>

                <FormError message={error} />

                <Field
                  label="Full name (as on your ID)"
                  leftIcon="person-outline"
                  value={name}
                  onChangeText={(v) => {
                    setName(v);
                    if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined }));
                  }}
                  error={fieldErrors.name}
                  placeholder="Priya Sharma"
                  autoCapitalize="words"
                  autoCorrect={false}
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  onSubmitEditing={() => usernameRef.current?.focus()}
                />

                <View style={styles.fieldGroup}>
                  <Field
                    ref={usernameRef}
                    label="Username"
                    leftIcon="at-outline"
                    value={username}
                    onChangeText={(v) => {
                      setUsername(v.toLowerCase().replace(/\s+/g, ''));
                      if (fieldErrors.username)
                        setFieldErrors((p) => ({ ...p, username: undefined }));
                    }}
                    error={fieldErrors.username}
                    placeholder="priya_finds"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                    rightSlot={
                      availability === 'available' ? (
                        <Ionicons name="checkmark-circle" size={18} color={Brand.successSoft} />
                      ) : availability === 'taken' ||
                        availability === 'reserved' ||
                        availability === 'invalid' ? (
                        <Ionicons name="close-circle" size={18} color={c.danger} />
                      ) : undefined
                    }
                  />
                  {!fieldErrors.username && (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={[styles.helper, { color: availabilityLine.color }]}
                    >
                      {availabilityLine.text}
                    </Text>
                  )}
                </View>

                <Field
                  ref={emailRef}
                  label="Email"
                  leftIcon="mail-outline"
                  value={email}
                  onChangeText={(v) => {
                    setEmail(v);
                    if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
                  }}
                  error={fieldErrors.email}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  keyboardType="email-address"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />

                <View style={styles.fieldGroup}>
                  <Field
                    ref={passwordRef}
                    label="Password"
                    leftIcon="lock-closed-outline"
                    value={password}
                    onChangeText={(v) => {
                      setPassword(v);
                      if (fieldErrors.password)
                        setFieldErrors((p) => ({ ...p, password: undefined }));
                    }}
                    error={fieldErrors.password}
                    placeholder="8+ characters, mixed case, number, symbol"
                    secureTextEntry={!showPassword}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="done"
                    onSubmitEditing={handleSignUp}
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                    rightSlot={
                      <Pressable
                        onPress={() => setShowPassword((s) => !s)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                      >
                        <Ionicons
                          name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                          size={19}
                          color={c.textSecondary}
                        />
                      </Pressable>
                    }
                  />
                  {password.length > 0 && (
                    <View style={styles.strengthRow}>
                      <View style={styles.strengthBars}>
                        {[1, 2, 3].map((seg) => (
                          <View
                            key={seg}
                            style={[
                              styles.strengthBar,
                              {
                                backgroundColor:
                                  strength.score >= seg
                                    ? seg === 1 && strength.score === 1
                                      ? c.danger
                                      : seg <= 2 && strength.score === 2
                                        ? Brand.amberDue
                                        : Brand.successSoft
                                    : c.backgroundSelected,
                              },
                            ]}
                          />
                        ))}
                      </View>
                      <Text style={[styles.strengthLabel, { color: c.textSecondary }]}>
                        {strength.label}
                      </Text>
                    </View>
                  )}
                  {showRequirements && (
                    <View style={styles.reqList}>
                      {(
                        [
                          ['length', 'At least 8 characters'],
                          ['upper', 'One uppercase and one lowercase letter'],
                          ['number', 'One number'],
                          ['symbol', 'One symbol'],
                        ] as const
                      ).map(([key, label]) => {
                        const met =
                          key === 'upper' ? checks.upper && checks.lower : checks[key];
                        return (
                          <View key={key} style={styles.reqRow}>
                            <Ionicons
                              name={met ? 'checkmark-circle' : 'ellipse-outline'}
                              size={13}
                              color={met ? Brand.successSoft : c.textFaint}
                            />
                            <Text
                              style={[
                                styles.reqText,
                                { color: met ? c.textSecondary : c.textFaint },
                              ]}
                            >
                              {label}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>

                <GradientCTA
                  title="Create account"
                  loadingTitle="Creating account…"
                  loading={busy}
                  disabled={socialBusy}
                  onPress={handleSignUp}
                  arrow="ring"
                />

                {/* Divider */}
                <View style={styles.dividerRow}>
                  <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
                  <Text style={[styles.dividerText, { color: c.textFaint }]}>
                    OR CONTINUE WITH
                  </Text>
                  <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
                </View>

                <SocialAuthButtons
                  busy={busy || socialBusy}
                  setBusy={setSocialBusy}
                  onError={setError}
                  onMfaRequired={() => router.replace({ pathname: '/sign-in', params: { mfa: '1' } })}
                />

                {/* Legal */}
                <Text style={[styles.legal, { color: c.textFaint }]}>
                  By creating an account, you agree to our{' '}
                  <Text
                    style={{ color: c.primary }}
                    onPress={() => WebBrowser.openBrowserAsync('https://anynall.com/terms')}
                    accessibilityRole="link"
                  >
                    Terms & Conditions
                  </Text>{' '}
                  and{' '}
                  <Text
                    style={{ color: c.primary }}
                    onPress={() => WebBrowser.openBrowserAsync('https://anynall.com/privacy')}
                    accessibilityRole="link"
                  >
                    Privacy Policy
                  </Text>
                  .
                </Text>
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
  scroll: { flexGrow: 1, padding: Spacing.four, paddingTop: Spacing.two },
  card: {
    gap: Spacing.three,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth / 2,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  backBtn: { marginLeft: -Spacing.one, padding: Spacing.one, minWidth: 44, minHeight: 34, justifyContent: 'center' },
  topRight: { flexDirection: 'row', alignItems: 'center' },
  topRightMuted: { fontSize: 13.5, fontFamily: Fonts.sans },
  topRightLink: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
  headingBlock: { gap: 2, marginTop: Spacing.one },
  sub: { fontSize: 15.5, fontFamily: Fonts.sans, lineHeight: 22, marginTop: Spacing.two },
  fieldGroup: { gap: Spacing.one + 2 },
  helper: { fontSize: 12.5, fontFamily: Fonts.sans },
  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one },
  strengthBars: { flex: 1, flexDirection: 'row', gap: Spacing.one + 2 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
  reqList: { gap: 4, marginTop: 2 },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  reqText: { fontSize: 12.5, fontFamily: Fonts.sans },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontFamily: Fonts.sansMedium, fontSize: 11, letterSpacing: 1.2 },
  legal: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18, textAlign: 'center' },
  resend: { alignSelf: 'center', paddingVertical: Spacing.one },
});
