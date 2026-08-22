// Verified buyer status — the audit's "buyer Aadhaar verification MISSING"
// gap. The web Account Settings offers DigiLocker verification to BUYERS; the
// app only ran it inside the seller wizard. This screen reuses the exact same
// backend flow (/api/digilocker/init → government DigiLocker journey →
// /api/digilocker/complete) outside the wizard.
//
// Verified state is read from users/{uid}.aadhaarVerified (owner read is
// allowed) — the same field both the seller wizard and this flow set, so
// verifying once counts everywhere: shows restricted to verified buyers, the
// seller wizard's identity step, and this badge.
//
// Same security posture as the wizard: the journey opens in a Custom Tab /
// SFSafariViewController (never an embedded WebView), no Aadhaar number or
// OTP is ever typed into Any&All, and the server verifies the document and
// the name match — the client only asks what happened.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { doc, getDoc } from 'firebase/firestore';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { GuestPrompt } from '@/components/guest-prompt';
import { GradientCTA } from '@/components/brand/gradient-cta';
import { useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import { db, auth } from '@/lib/firebase';
import { completeDigiLocker, initDigiLocker } from '@/lib/seller';
import { useSession } from '@/lib/session';

const SESSION_KEY = 'anynall:digilocker-session';
const ORIGIN_KEY = 'anynall:digilocker-origin';
const APP_REDIRECT = 'anynallmobile://digilocker-complete';

type Phase =
  | 'loading'
  | 'idle'
  | 'creating'
  | 'opening'
  | 'checking'
  | 'pending'
  | 'verified'
  | 'mismatch'
  | 'error';

export default function VerifyIdentityScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();
  const { user } = useSession();

  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [masked, setMasked] = useState<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const checking = useRef(false);

  // Initial state: verified flag from users/{uid}, plus any session left over
  // from a journey that ended while the app was away.
  useEffect(() => {
    if (status !== 'member' || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;
        const d = snap.exists() ? (snap.data() as any) : {};
        if (d.aadhaarVerified === true) {
          setMasked(d.aadhaarMaskedNumber || null);
          setPhase('verified');
          return;
        }
        const stored = await AsyncStorage.getItem(SESSION_KEY);
        const origin = await AsyncStorage.getItem(ORIGIN_KEY);
        if (stored && origin === 'buyer') {
          sessionId.current = stored;
          if (!cancelled) await checkStatus(true);
          return;
        }
        if (!cancelled) setPhase('idle');
      } catch {
        if (!cancelled) setPhase('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user?.uid]);

  async function checkStatus(auto = false) {
    const sid = sessionId.current;
    if (!sid || checking.current) return;
    checking.current = true;
    setPhase('checking');
    setMessage(null);
    try {
      const res = await completeDigiLocker(sid);
      if (res.verified) {
        await AsyncStorage.removeItem(SESSION_KEY);
        sessionId.current = null;
        setMasked(res.maskedAadhaar || null);
        setPhase('verified');
      } else if (res.error === 'NAME_MISMATCH') {
        setPhase('mismatch');
        setMessage(
          `The name on your Aadhaar (${res.aadhaarName ?? '—'}) doesn’t match your account name (${res.accountName ?? '—'}). They must match to verify.`
        );
      } else {
        setPhase('pending');
        setMessage(
          auto ? 'DigiLocker hasn’t confirmed yet — finish the journey, then check again.' : res.message ?? null
        );
      }
    } catch {
      await AsyncStorage.removeItem(SESSION_KEY);
      sessionId.current = null;
      setPhase('error');
      setMessage('We couldn’t complete verification right now. Start again when you’re ready.');
    } finally {
      checking.current = false;
    }
  }

  // Auto-check when the app returns to the foreground mid-journey.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      if (!sessionId.current || phase === 'verified' || phase === 'checking') return;
      void checkStatus(true);
    });
    return () => sub.remove();
  }, [phase]);

  async function startVerification() {
    setMessage(null);
    setPhase('creating');
    try {
      const { sessionId: sid, authUrl } = await initDigiLocker();
      sessionId.current = sid;
      await AsyncStorage.setItem(SESSION_KEY, sid);
      // Landing route reads this to return HERE, not to the seller wizard.
      await AsyncStorage.setItem(ORIGIN_KEY, 'buyer');
      setPhase('opening');
      await WebBrowser.openAuthSessionAsync(authUrl, APP_REDIRECT);
      await checkStatus(true);
    } catch {
      setPhase('error');
      setMessage('Couldn’t start the DigiLocker journey. Check your connection and try again.');
    }
  }

  const busy = phase === 'creating' || phase === 'opening' || phase === 'checking';

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
        <Text style={[styles.topTitle, { color: c.text }]}>Verified buyer</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="finger-print-outline"
          title="Sign in to verify your identity"
          body="Verified buyers can bid in every stream, including verified-only shows."
          reason="profile"
        />
      ) : phase === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {phase === 'verified' ? (
            <View style={styles.done}>
              <View style={[styles.doneRing, { borderColor: 'rgba(74,222,128,0.4)' }]}>
                <Ionicons name="shield-checkmark" size={30} color="#4ade80" />
              </View>
              <Text style={[styles.doneTitle, { color: c.text }]}>You’re a verified buyer</Text>
              <Text style={[styles.body, styles.doneBody, { color: c.textSecondary }]}>
                Your identity is verified{masked ? ` (Aadhaar ${masked})` : ''}. You can bid in
                every stream, including shows restricted to verified buyers — on the app and the
                website alike.
              </Text>
            </View>
          ) : (
            <>
              <Text style={[styles.body, { color: c.textSecondary }]}>
                Verify your identity once with Aadhaar via DigiLocker — the government’s own
                document locker — and you can bid in every stream, including verified-only shows.
                It keeps the community safe for everyone.
              </Text>

              <View style={styles.card}>
                {(
                  [
                    ['lock-closed-outline', 'You sign in on DigiLocker’s own page — never inside Any&All. No Aadhaar number, password or OTP is ever typed here.'],
                    ['document-text-outline', 'DigiLocker shares your e-Aadhaar with our verification partner; the name must match your account name.'],
                    ['shield-checkmark-outline', 'We store only the verification result and a masked number — never the document.'],
                  ] as const
                ).map(([icon, text], i) => (
                  <View key={icon} style={[styles.pointRow, i > 0 && { marginTop: Spacing.two }]}>
                    <Ionicons name={icon} size={17} color={c.primary} />
                    <Text style={[styles.pointText, { color: c.textSecondary }]}>{text}</Text>
                  </View>
                ))}
              </View>

              {!!message && (
                <View
                  style={[
                    styles.msgBox,
                    { borderColor: phase === 'mismatch' ? 'rgba(255,196,107,0.4)' : Brand.hairlineWhite },
                  ]}
                >
                  <Text style={[styles.msgText, { color: c.textSecondary }]}>{message}</Text>
                  {phase === 'mismatch' && (
                    <PressScale
                      onPress={() => router.push('/account/edit-profile')}
                      accessibilityRole="button"
                      accessibilityLabel="Fix your account name"
                      hitSlop={6}
                    >
                      <Text style={[styles.msgLink, { color: c.primary }]}>
                        Fix your account name →
                      </Text>
                    </PressScale>
                  )}
                </View>
              )}

              <GradientCTA
                title={
                  busy
                    ? phase === 'checking'
                      ? 'Checking with DigiLocker…'
                      : 'Opening DigiLocker…'
                    : phase === 'pending'
                      ? 'Check verification again'
                      : 'Verify with DigiLocker'
                }
                onPress={phase === 'pending' ? () => checkStatus(false) : startVerification}
                disabled={busy}
              />
              {phase === 'pending' && (
                <PressScale
                  onPress={startVerification}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Start the DigiLocker journey again"
                  style={styles.again}
                >
                  <Text style={[styles.againText, { color: c.textSecondary }]}>
                    Start the journey again
                  </Text>
                </PressScale>
              )}
              {!auth.currentUser?.displayName?.trim() && (
                <Text style={[styles.hint, { color: c.textFaint }]}>
                  Your account has no name set — add your full legal name in Edit profile first, as
                  it must match your Aadhaar.
                </Text>
              )}
            </>
          )}
        </ScrollView>
      )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
  safe: { flex: 1 },
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.three, paddingBottom: 90 },
  body: { fontSize: 14, fontFamily: Fonts.ui, lineHeight: 21 },
  hint: { fontSize: 12.5, fontFamily: Fonts.ui, lineHeight: 18, textAlign: 'center' },

  card: {
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: Spacing.three + Spacing.one,
  },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one },
  pointText: { flex: 1, fontSize: 13, fontFamily: Fonts.ui, lineHeight: 19 },

  msgBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
    backgroundColor: 'rgba(255,196,107,0.05)',
  },
  msgText: { fontSize: 13, fontFamily: Fonts.ui, lineHeight: 19 },
  msgLink: { fontSize: 13, fontFamily: Fonts.uiMedium, paddingVertical: 2 },

  again: { alignSelf: 'center', paddingVertical: Spacing.one, minHeight: 40, justifyContent: 'center' },
  againText: { fontSize: 13, fontFamily: Fonts.uiMedium },

  done: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  doneRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  doneTitle: { fontSize: 20, fontFamily: Fonts.displayMedium, letterSpacing: -0.5, textAlign: 'center' },
  doneBody: { textAlign: 'center', maxWidth: 330 },
});
