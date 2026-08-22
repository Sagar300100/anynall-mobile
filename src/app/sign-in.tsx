// Sign-in — the app's front door. Composition (top → bottom): brand mark,
// welcome heading, unified glass credential card, forgot link, gradient CTA,
// `or` divider, social buttons, sign-up panel, trust footer.
//
// Presentation only — every auth path is the existing service (lib/api,
// lib/auth-social). Success needs no navigation: SessionProvider sees the user
// and the root Stack.Protected guard swaps to the (app) group.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GradientCTA, GradientWord, SocialAuthButtons } from '@/components/auth-ui';
import { BrandLogo } from '@/components/brand-logo';
import { CosmicAuthBackground } from '@/components/cosmic-background';
import {
  GlassCredentialForm,
  GlassPanel,
  GLASS_STROKE,
} from '@/components/glass-credential-form';
import { SignupGlassPanel } from '@/components/signup-glass-panel';
import { useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { login, resolveMfaLogin } from '@/lib/api';
import { GATE_REASON, useReturnAfterAuth, type GatedAction } from '@/lib/auth-gate';
import { getReducedMotionSync } from '@/lib/motion';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function SignInScreen() {
  const c = useBrandColors();
  const { width, height } = useWindowDimensions();
  // The app is browsable signed-out, so this screen is pushed on top of
  // wherever the user was; on success we pop back to it.
  useReturnAfterAuth();
  // Compact phones (≈360×800 and below) tighten gaps before touching type size.
  // Everything is budgeted against the real viewport height so the whole
  // composition fits without scrolling; only the keyboard causes a scroll.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const gap = Math.round(clamp(height * 0.0105, 7, 14));
  // The mark leads the composition; everything below it stays deliberately
  // understated so the brand is the only large element on screen.
  const logoSize = Math.round(clamp(Math.min(height * 0.148, width * 0.46), 104, 160));
  const headingSize = Math.round(clamp(height * 0.028, 20, 25));

  // `reason` is set by lib/auth-gate when a specific gated action sent the
  // user here; it drives the subtitle so the ask is never generic.
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const gateReason =
    reason && reason in GATE_REASON ? GATE_REASON[reason as GatedAction] : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'email' | 'mfa'>(null);
  const [socialBusy, setSocialBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  // Gentle entrance: fade + slight lift; skipped for reduced motion.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let cancelled = false;
    const run = (reduced: boolean) => {
      if (cancelled) return;
      if (reduced) return enter.setValue(1);
      Animated.timing(enter, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    };
    // Cached flag (lib/motion) → the entrance starts on the first frame; the
    // async query is only the cold-start fallback before the cache seeds.
    const cached = getReducedMotionSync();
    if (cached !== null) run(cached);
    else
      AccessibilityInfo.isReduceMotionEnabled()
        .then(run)
        .catch(() => enter.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [enter]);

  function validate(): boolean {
    const cleanEmail = email.trim();
    if (!cleanEmail) return setFieldError('Enter your email address.'), false;
    if (!EMAIL_RE.test(cleanEmail)) return setFieldError('Enter a valid email address.'), false;
    if (!password) return setFieldError('Enter your password.'), false;
    setFieldError(null);
    return true;
  }

  async function handleSignIn() {
    if (busy || socialBusy) return;
    setError(null);
    if (!validate()) return;
    Keyboard.dismiss();
    setBusy('email');
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      if (err?.code === 'MFA_REQUIRED') setMfaStep(true);
      else setError(err?.message || 'Sign-in failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function handleMfa() {
    if (busy || socialBusy) return;
    setError(null);
    Keyboard.dismiss();
    setBusy('mfa');
    try {
      await resolveMfaLogin(mfaCode);
    } catch (err: any) {
      setError(err?.message || 'Invalid code. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const shownError = error ?? fieldError;
  const animStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <CosmicAuthBackground />
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View style={[styles.card, { gap }, animStyle]}>
              <View style={styles.center}>
                <BrandLogo size={logoSize} />
              </View>

              <View style={styles.center}>
                {/* Both lines carry the sky→bright blue gradient (no purple —
                    blue-on-black only, per the design language). */}
                <GradientWord size={headingSize}>Welcome</GradientWord>
                <GradientWord size={headingSize}>back!</GradientWord>
                <Text style={[styles.sub, { color: c.textSecondary }]}>
                  {mfaStep
                    ? 'Enter the 6-digit code from your\nauthenticator app.'
                    : // When a gated action sent the user here, say which one —
                      // a generic prompt gives them no reason to continue.
                      (gateReason ?? 'Sign in to continue your live\nshopping journey.')}
                </Text>
              </View>

              {mfaStep ? (
                <>
                  <GlassPanel>
                    <View style={styles.mfaRow}>
                      <Ionicons name="shield-checkmark-outline" size={19} color={c.primary} />
                      <TextInput
                        value={mfaCode}
                        onChangeText={setMfaCode}
                        placeholder="6-digit code"
                        placeholderTextColor="rgba(206,220,255,0.52)"
                        style={styles.mfaInput}
                        keyboardType="number-pad"
                        maxLength={6}
                        accessibilityLabel="Authentication code"
                        autoFocus
                      />
                    </View>
                  </GlassPanel>
                  {!!shownError && (
                    <Text accessibilityLiveRegion="polite" style={[styles.err, { color: c.danger }]}>
                      {shownError}
                    </Text>
                  )}
                  <GradientCTA
                    title="Verify"
                    loadingTitle="Verifying…"
                    loading={busy === 'mfa'}
                    onPress={handleMfa}
                  />
                </>
              ) : (
                <>
                  <GlassCredentialForm
                    email={email}
                    password={password}
                    onEmail={(v) => {
                      setEmail(v);
                      if (fieldError) setFieldError(null);
                      if (error) setError(null);
                    }}
                    onPassword={(v) => {
                      setPassword(v);
                      if (fieldError) setFieldError(null);
                      if (error) setError(null);
                    }}
                    showPassword={showPassword}
                    onTogglePassword={() => setShowPassword((s) => !s)}
                    onSubmit={handleSignIn}
                    passwordRef={passwordRef}
                    error={shownError}
                  />

                  <Link
                    href="/forgot-password"
                    style={[styles.forgot, { color: Brand.authAccent }]}
                  >
                    Forgot password?
                  </Link>

                  <GradientCTA
                    title="Sign in"
                    loadingTitle="Signing in…"
                    loading={busy === 'email'}
                    disabled={socialBusy}
                    onPress={handleSignIn}
                  />

                  <View style={styles.orRow}>
                    <View style={[styles.orLine, { backgroundColor: GLASS_STROKE }]} />
                    <Text style={[styles.orText, { color: c.textFaint }]}>or</Text>
                    <View style={[styles.orLine, { backgroundColor: GLASS_STROKE }]} />
                  </View>

                  <SocialAuthButtons
                    busy={busy !== null || socialBusy}
                    setBusy={setSocialBusy}
                    onError={setError}
                    onMfaRequired={() => setMfaStep(true)}
                    variant="compact"
                  />

                  <SignupGlassPanel onPress={() => router.push('/sign-up')} />

                  <View style={styles.trust}>
                    <Ionicons name="shield-checkmark-outline" size={13} color={c.textFaint} />
                    <Text style={[styles.trustText, { color: c.textFaint }]}>
                      Secure · Private · Trusted
                    </Text>
                  </View>
                </>
              )}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    // Centred but biased well upward: the extra bottom padding lifts the stack
    // off dead-centre without stranding it at the very top.
    justifyContent: 'center',
    paddingHorizontal: '6%', // card ≈ 88% of screen width
    paddingTop: Spacing.one,
    paddingBottom: Spacing.six,
  },
  card: { width: '100%', alignSelf: 'center', maxWidth: 420 },
  center: { alignItems: 'center' },
  sub: {
    // 13.5 is about the floor for comfortable body copy; below that it reads
    // as fine print rather than a subtitle.
    fontSize: 11.5,
    fontFamily: Fonts.sans,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 2,
  },
  forgot: {
    alignSelf: 'flex-end',
    fontSize: 12,
    fontFamily: Fonts.sansMedium,
    marginTop: -Spacing.two,
    paddingVertical: Spacing.one,
  },
  mfaRow: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three - 2,
  },
  mfaInput: { flex: 1, height: '100%', color: '#FFFFFF', fontSize: 15.5, fontFamily: Fonts.sans },
  err: { fontSize: 13, fontFamily: Fonts.sansMedium },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth },
  orText: { fontFamily: Fonts.sans, fontSize: 11.5 },
  trust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  trustText: { fontSize: 11.5, fontFamily: Fonts.sans, letterSpacing: 0.3 },
});
