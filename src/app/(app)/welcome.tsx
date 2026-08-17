// First-run buyer setup — two steps, both skippable.
//
// Step 1  Interests   → what the feed should lead with.
// Step 2  Delivery    → the address every purchase path already needs.
//
// The address step matters more than it looks: a composition or eligible
// unregistered seller may only deliver inside their own State, so without an
// address on file a buyer finds that out at the moment they try to bid.
// Collecting it here turns a dead end into a filter.
//
// Nothing here is mandatory. Both steps can be skipped and changed later from
// Profile → Saved addresses, and the server records a skip so we stop asking.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { StatePicker } from '@/components/state-picker';
import { Field, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { saveCommerceProfile, type ShippingAddress } from '@/lib/commerce';
import {
  getOnboardingState,
  INTEREST_CATEGORIES,
  saveInterests,
  skipInterests,
} from '@/lib/onboarding';
import { useSession } from '@/lib/session';

export default function WelcomeScreen() {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();
  const { user } = useSession();

  // The recipient name comes from the account and is NOT editable here — a
  // delivery name that disagrees with the account name is a dispute waiting to
  // happen, and couriers match it against ID. Change it in Profile instead.
  const accountName = (user?.displayName || '').trim();

  const [step, setStep] = useState<1 | 2>(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [addr, setAddr] = useState<Partial<ShippingAddress>>({ name: accountName });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(cat: string) {
    setPicked((p) => (p.includes(cat) ? p.filter((x) => x !== cat) : [...p, cat].slice(0, 8)));
  }

  function done() {
    router.replace('/');
  }

  // Interests already answered (or skipped) previously → go straight to the
  // step that is actually required.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await getOnboardingState();
      if (!cancelled && state && state.interestsCompleted) setStep(2);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitInterests() {
    setError(null);
    setBusy(true);
    try {
      await saveInterests(picked);
      setStep(2);
    } catch {
      setError('Couldn’t save your choices. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function skipStep1() {
    setBusy(true);
    try {
      await skipInterests();
    } catch {
      /* declining is best-effort — never block the app on it */
    } finally {
      setBusy(false);
      setStep(2);
    }
  }

  async function submitAddress() {
    setError(null);
    const pincode = String(addr.pincode || '').trim();
    if (!addr.name?.trim() || !addr.line1?.trim() || !addr.city?.trim()) {
      return setError('Name, address and city are required.');
    }
    if (!/^[6-9][0-9]{9}$/.test(String(addr.phone || '').replace(/\D/g, ''))) {
      return setError('Enter a valid 10-digit mobile number.');
    }
    if (!addr.stateCode) return setError('Select your delivery State.');
    if (!/^[1-9][0-9]{5}$/.test(pincode)) return setError('Enter a valid 6-digit PIN code.');

    setBusy(true);
    try {
      await saveCommerceProfile({
        savedAddress: {
          name: addr.name.trim(),
          phone: String(addr.phone).replace(/\D/g, ''),
          line1: addr.line1.trim(),
          city: addr.city.trim(),
          stateCode: addr.stateCode,
          pincode,
        },
      });
      done();
    } catch {
      setError('Couldn’t save your address. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.step, { color: c.primary }]}>Step {step} of 2</Text>

          {step === 1 ? (
            <>
              <Text style={[styles.title, { color: c.text }]}>What are you into?</Text>
              <Text style={[styles.body, { color: c.textSecondary }]}>
                We’ll lead your feed with these. Pick as many as you like — you can change them
                whenever.
              </Text>

              <View style={styles.chips}>
                {INTEREST_CATEGORIES.map((cat) => {
                  const on = picked.includes(cat);
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => toggle(cat)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={cat}
                      style={({ pressed }) => [
                        styles.chip,
                        {
                          backgroundColor: on ? c.primary : c.cardBackground,
                          borderColor: on ? c.primary : c.border,
                        },
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      {on && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
                      <Text style={[styles.chipText, { color: on ? '#FFFFFF' : c.text }]}>{cat}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.title, { color: c.text }]}>Where should we deliver?</Text>
              <Text style={[styles.body, { color: c.textSecondary }]}>
                Some sellers can only ship within their own State, so your address decides what you
                can buy. We’ll show it up front instead of at checkout.
              </Text>

              <View style={{ gap: Spacing.two, marginTop: Spacing.two }}>
                <Field
                  label={accountName ? 'Full name (from your account)' : 'Full name'}
                  value={addr.name || ''}
                  onChangeText={(t) => setAddr((a) => ({ ...a, name: t }))}
                  editable={!accountName}
                  accessibilityLabel="Full name"
                  style={accountName ? { color: c.textSecondary } : undefined}
                />
                <Field
                  label="Mobile number"
                  value={addr.phone || ''}
                  onChangeText={(t) => setAddr((a) => ({ ...a, phone: t.replace(/\D/g, '').slice(0, 10) }))}
                  keyboardType="number-pad"
                  accessibilityLabel="Mobile number"
                />
                <Field
                  label="House / street"
                  value={addr.line1 || ''}
                  onChangeText={(t) => setAddr((a) => ({ ...a, line1: t }))}
                  accessibilityLabel="House and street"
                />
                <Field
                  label="City"
                  value={addr.city || ''}
                  onChangeText={(t) => setAddr((a) => ({ ...a, city: t }))}
                  accessibilityLabel="City"
                />
                <Field
                  label="PIN code"
                  value={addr.pincode || ''}
                  onChangeText={(t) => setAddr((a) => ({ ...a, pincode: t.replace(/\D/g, '').slice(0, 6) }))}
                  keyboardType="number-pad"
                  accessibilityLabel="PIN code"
                />
                <StatePicker
                  label="State"
                  value={addr.stateCode || ''}
                  onChange={(code) => setAddr((a) => ({ ...a, stateCode: code }))}
                  placeholder="Choose your State"
                />
              </View>
            </>
          )}

          {!!error && (
            <View style={styles.err}>
              <Ionicons name="alert-circle-outline" size={16} color="#E5484D" />
              <Text style={styles.errText}>{error}</Text>
            </View>
          )}
        </ScrollView>

        <View
          style={[
            styles.actions,
            { borderTopColor: c.border, backgroundColor: c.background, paddingBottom: insets.bottom + Spacing.two },
          ]}
        >
          {/* Interests are optional. The delivery address is NOT: it decides
              which sellers can ship to you, so without it a buyer only finds
              out at the moment they try to bid. No skip on step 2. */}
          {step === 1 && (
            <Pressable
              onPress={skipStep1}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Skip for now"
              style={({ pressed }) => [styles.skip, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.skipText, { color: c.textSecondary }]}>Skip for now</Text>
            </Pressable>
          )}

          <Pressable
            onPress={step === 1 ? submitInterests : submitAddress}
            disabled={busy || (step === 1 && picked.length === 0)}
            accessibilityRole="button"
            accessibilityLabel={step === 1 ? 'Continue' : 'Save address'}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: c.primary },
              (busy || (step === 1 && picked.length === 0)) && { opacity: 0.45 },
              pressed && { opacity: 0.85 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaText}>{step === 1 ? 'Continue' : 'Save address'}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.two },
  step: { fontSize: 12.5, fontFamily: Fonts.sansSemiBold, letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontSize: 27, fontFamily: Fonts.sansSemiBold, lineHeight: 33 },
  body: { fontSize: 14.5, fontFamily: Fonts.sans, lineHeight: 21 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    minHeight: 46,
  },
  chipText: { fontSize: 14.5, fontFamily: Fonts.sansMedium },

  err: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: Spacing.two },
  errText: { flex: 1, color: '#E5484D', fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  skip: { minHeight: 52, paddingHorizontal: Spacing.two, justifyContent: 'center' },
  skipText: { fontSize: 15, fontFamily: Fonts.sansMedium },
  cta: { flex: 1, minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
});
