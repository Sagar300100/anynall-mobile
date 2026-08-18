// Payments — mobile port of the website's components/settings/PaymentsPanel.
//
// The buyer's preferred Razorpay Checkout method: a DISPLAY preference only.
// It decides which screen Checkout opens on (UPI or Card); every payment is
// still confirmed by the buyer inside Razorpay's own secure sheet. We never
// store card numbers, CVV, UPI IDs or PINs — the website's disclaimer block
// is preserved verbatim in spirit because without it, picking a method shows
// a ✓ that reads as "my card is saved now", which it is not (and by law only
// Razorpay's window may collect those details).
//
// Saved to users/{uid}.commerce.preferredMethod, so live-room checkouts and
// the winner drawer on BOTH clients pre-select it instead of asking again.
//
// PARITY NOTE — the website's UpiModal (collecting a raw UPI ID) has no
// consumer and contradicts the panel's own compliance note; api.ts's
// setupUpiAutopay calls /api/payments/upi-autopay/setup, which does not exist
// in the deployed paymentsRouter. Neither is ported — no fake UI.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import { getCommerceProfile, saveCommerceProfile } from '@/lib/commerce';

type Method = 'upi' | 'card';

const OPTIONS: { key: Method; label: string; hint: string; icon: string }[] = [
  { key: 'upi', label: 'UPI', hint: 'GPay, PhonePe, Paytm…', icon: 'flash-outline' },
  { key: 'card', label: 'Card', hint: 'Debit or credit', icon: 'card-outline' },
];

export default function PaymentsScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [method, setMethod] = useState<Method | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<'saved' | 'error' | null>(null);

  useEffect(() => {
    if (status !== 'member') return;
    let cancelled = false;
    getCommerceProfile()
      .then((p) => {
        if (!cancelled) setMethod(p.preferredMethod);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function choose(m: Method) {
    if (saving || loading || m === method) return;
    setSaving(true);
    setNote(null);
    const prev = method;
    setMethod(m); // optimistic — same pattern as the web panel
    try {
      await saveCommerceProfile({ preferredMethod: m });
      setNote('saved');
    } catch {
      // Never claim a state the server didn't accept.
      setMethod(prev);
      setNote('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Payments</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="card-outline"
          title="Sign in to set payment preferences"
          body="Pick which method checkout opens on, so buying and winning stays one tap."
          reason="profile"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.body, { color: c.textSecondary }]}>
            Choose which method Razorpay Checkout opens on when you buy or win an item. It only
            saves you a tap — nothing is ever charged without you confirming each payment. Your UPI
            PIN stays in your UPI app and your card OTP stays with your bank; we never store card
            numbers, CVV or UPI IDs.
          </Text>

          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
            PREFERRED PAYMENT METHOD
          </Text>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : loadError ? (
            <Text style={[styles.body, { color: c.textSecondary }]}>
              Couldn’t load your preference. Check your connection and try again.
            </Text>
          ) : (
            <>
              <View style={styles.options}>
                {OPTIONS.map(({ key, label, hint, icon }) => {
                  const active = method === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => choose(key)}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel={`${label} — ${hint}`}
                      accessibilityState={{ selected: active, disabled: saving }}
                      style={[
                        styles.option,
                        active
                          ? { backgroundColor: c.cta, borderColor: c.cta }
                          : { backgroundColor: c.cardBackground, borderColor: c.border },
                      ]}
                    >
                      <Ionicons
                        name={icon as never}
                        size={20}
                        color={active ? c.ctaText : c.primary}
                      />
                      <View style={styles.optionText}>
                        <Text style={[styles.optionLabel, { color: active ? c.ctaText : c.text }]}>
                          {label}
                        </Text>
                        <Text
                          style={[
                            styles.optionHint,
                            { color: active ? 'rgba(11,31,63,0.65)' : c.textSecondary },
                          ]}
                        >
                          {hint}
                        </Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={20} color={c.ctaText} />}
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.noteRow} accessibilityLiveRegion="polite">
                {note === 'saved' && (
                  <Text style={[styles.noteText, { color: '#4ade80' }]}>✓ Saved</Text>
                )}
                {note === 'error' && (
                  <Text style={[styles.noteText, { color: c.danger }]}>
                    Couldn’t save — please retry
                  </Text>
                )}
                {!method && !note && (
                  <Text style={[styles.noteText, { color: c.textFaint }]}>
                    No preference set — you’ll pick a method at checkout.
                  </Text>
                )}
              </View>

              {/* Same guardrail as the web panel: a ✓ alone reads as "my card
                  is saved now" — it is not, and must never appear to be. */}
              {!!method && (
                <View style={[styles.disclaimer, { borderColor: 'rgba(255,178,64,0.25)' }]}>
                  <Ionicons name="information-circle-outline" size={16} color="#ffb240" />
                  <Text style={[styles.disclaimerText, { color: c.textSecondary }]}>
                    <Text style={{ color: c.text, fontFamily: Fonts.sansMedium }}>
                      This is only a preference — no {method === 'card' ? 'card' : 'UPI'} details
                      are stored here.{' '}
                    </Text>
                    {method === 'card'
                      ? 'You’ll enter your card once during your next payment, inside Razorpay’s secure window, where you can tick “save this card”. After that it’s one tap plus CVV.'
                      : 'You’ll enter your UPI ID during your next payment, inside Razorpay’s secure window, where it can be saved. After that it’s one tap plus your UPI PIN.'}{' '}
                    By law only Razorpay’s payment window may collect these details — never a
                    screen like this one.
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.sansSemiBold },

  scroll: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.three, paddingBottom: Spacing.six },
  body: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 21 },
  sectionLabel: {
    fontSize: 11.5,
    fontFamily: Fonts.sansMedium,
    letterSpacing: 1.1,
    marginLeft: 4,
    marginBottom: -Spacing.two,
  },
  loading: { paddingVertical: Spacing.four, alignItems: 'center' },

  options: { gap: Spacing.two },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    minHeight: 62,
  },
  optionText: { flex: 1, gap: 1 },
  optionLabel: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  optionHint: { fontSize: 12.5, fontFamily: Fonts.sans },

  noteRow: { minHeight: 20, justifyContent: 'center' },
  noteText: { fontSize: 13, fontFamily: Fonts.sansMedium },

  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    backgroundColor: 'rgba(255,178,64,0.06)',
  },
  disclaimerText: { flex: 1, fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 19 },
});
