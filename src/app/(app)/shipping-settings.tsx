// Shipping settings — mobile port of the pickup-address half of the
// website's ShipmentsPanel, against /api/shipping/status|pickup|rates.
// Replaces the Seller Tools "Shipping Settings" stub.
//
// One pickup address per seller: the server derives a stable Shiprocket
// nickname from the uid and re-saving reuses it, so fixing a typo never mints
// a duplicate location. The rate checker is the read-only courier quote —
// useful for sanity-checking a shipping fee before setting product prices.
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { StatePicker } from '@/components/state-picker';
import { Field, FormError, PrimaryButton, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import { IN_STATES } from '@/lib/seller';
import {
  getPickupAddress,
  getShippingRates,
  getShippingStatus,
  savePickupAddress,
  type CourierRate,
  type PickupAddress,
} from '@/lib/shipping';

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    const m = err.message.match(/"message"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
  }
  return fallback;
}

export default function ShippingSettingsScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [registered, setRegistered] = useState(false);
  const [editing, setEditing] = useState(false);

  const [form, setForm] = useState<Partial<PickupAddress>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Rate checker.
  const [ratePin, setRatePin] = useState('');
  const [rateWeight, setRateWeight] = useState('500');
  const [rates, setRates] = useState<CourierRate[] | null>(null);
  const [rateBusy, setRateBusy] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'member') return;
    let cancelled = false;
    (async () => {
      try {
        const [st, pk] = await Promise.all([getShippingStatus(), getPickupAddress()]);
        if (cancelled) return;
        setConfigured(st.configured);
        setRegistered(st.pickupRegistered);
        setForm(pk.pickup || {});
        setEditing(!pk.pickup); // nothing saved → open the form directly
      } catch {
        if (!cancelled) setSaveError('Couldn’t load your shipping settings. Pull back and retry.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const set = (k: keyof PickupAddress) => (v: string) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  };

  async function save() {
    // Mirror the server's checks so the round trip almost never fails.
    const phone = String(form.phone || '').replace(/\D/g, '');
    const pincode = String(form.pincode || '').trim();
    setSaveError(null);
    if (!form.name?.trim()) return setSaveError('Enter the contact name for pickup.');
    if (!/^[6-9][0-9]{9}$/.test(phone)) return setSaveError('Enter a valid 10-digit mobile number.');
    if ((form.address || '').trim().length < 10) return setSaveError('Enter the full pickup address.');
    if (!form.city?.trim()) return setSaveError('Enter the pickup city.');
    if (!form.state?.trim()) return setSaveError('Select the pickup State.');
    if (!/^[1-9][0-9]{5}$/.test(pincode)) return setSaveError('Enter a valid 6-digit PIN code.');
    if (!form.email?.trim()) return setSaveError('Enter a contact email for pickup.');

    setSaving(true);
    try {
      await savePickupAddress({
        name: form.name.trim(),
        email: form.email.trim(),
        phone,
        address: (form.address || '').trim(),
        address2: (form.address2 || '').trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode,
      });
      setRegistered(true);
      setEditing(false);
      setJustSaved(true);
    } catch (err) {
      setSaveError(apiMessage(err, 'Could not save the pickup address. Please retry.'));
    } finally {
      setSaving(false);
    }
  }

  async function checkRates() {
    const pin = ratePin.trim();
    const weight = Number(rateWeight) || 500;
    setRateError(null);
    if (!/^[1-9][0-9]{5}$/.test(pin)) {
      setRateError('Enter a valid 6-digit destination PIN code.');
      return;
    }
    setRateBusy(true);
    setRates(null);
    try {
      const r = await getShippingRates(pin, weight);
      setRates(r.couriers || []);
    } catch (err) {
      setRateError(apiMessage(err, 'Couldn’t fetch courier rates. Try again.'));
    } finally {
      setRateBusy(false);
    }
  }

  // State names for the picker — Shiprocket takes the NAME, not the GST code.
  const stateOptions = IN_STATES.map((s) => ({ code: s.name, name: s.name }));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/seller-tools'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Shipping settings</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="cube-outline"
          title="Sign in to manage shipping"
          body="Your pickup address and courier rates live here once you're signed in."
          reason="sell"
        />
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
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
            {!configured && (
              <View style={[styles.warnBox, { borderColor: 'rgba(255,196,107,0.35)' }]}>
                <Ionicons name="construct-outline" size={16} color="#FFC46B" />
                <Text style={[styles.warnText, { color: c.textSecondary }]}>
                  Courier booking isn’t switched on for the platform yet — you can still save your
                  pickup address so you’re ready the moment it is.
                </Text>
              </View>
            )}

            {/* ── Pickup address ── */}
            <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>PICKUP ADDRESS</Text>
            {justSaved && !editing && (
              <View style={[styles.okBox, { borderColor: 'rgba(74,222,128,0.35)' }]}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#4ade80" />
                <Text style={[styles.okText, { color: '#4ade80' }]}>
                  Pickup address registered with the courier network
                </Text>
              </View>
            )}

            {!editing && form.name ? (
              <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
                <View style={styles.cardHead}>
                  <Ionicons name="storefront-outline" size={18} color={c.primary} />
                  <Text style={[styles.cardName, { color: c.text }]}>{form.name}</Text>
                  {registered && (
                    <View style={[styles.badge, { borderColor: 'rgba(74,222,128,0.4)' }]}>
                      <Text style={styles.badgeText}>Registered</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.body, { color: c.textSecondary }]}>
                  {form.address}
                  {form.address2 ? `\n${form.address2}` : ''}
                  {`\n${form.city}, ${form.state} ${form.pincode}`}
                  {`\n+91 ${form.phone} · ${form.email}`}
                </Text>
                <PrimaryButton title="Edit pickup address" variant="ghost" onPress={() => { setJustSaved(false); setEditing(true); }} />
              </View>
            ) : (
              <View style={styles.form}>
                <Field label="Contact name" value={form.name || ''} onChangeText={set('name')} autoComplete="name" />
                <Field label="Contact email" value={form.email || ''} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
                <Field label="Mobile number" value={form.phone || ''} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="10-digit mobile" />
                <Field label="Address line 1" value={form.address || ''} onChangeText={set('address')} placeholder="Building, street" />
                <Field label="Address line 2 (optional)" value={form.address2 || ''} onChangeText={set('address2')} placeholder="Area, landmark" />
                <Field label="City" value={form.city || ''} onChangeText={set('city')} />
                <StatePicker
                  label="State / Union Territory"
                  value={form.state || ''}
                  onChange={(name) => setForm((prev) => ({ ...prev, state: name }))}
                  options={stateOptions}
                />
                <Field label="PIN code" value={form.pincode || ''} onChangeText={set('pincode')} keyboardType="number-pad" placeholder="6-digit PIN" />
                <FormError message={saveError} />
                <PrimaryButton title="Save pickup address" onPress={save} loading={saving} />
                {!!form.name && registered && (
                  <Pressable
                    onPress={() => setEditing(false)}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel editing"
                    style={({ pressed }) => [styles.cancel, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Text style={[styles.cancelText, { color: c.textSecondary }]}>Cancel</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* ── Rate checker ── */}
            <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>COURIER RATE CHECK</Text>
            <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              <Text style={[styles.body, { color: c.textSecondary }]}>
                Quote real courier prices from your pickup PIN to any destination — handy before
                setting a shipping fee. Prepaid only; payment always clears before anything ships.
              </Text>
              <Field
                label="Destination PIN code"
                value={ratePin}
                onChangeText={setRatePin}
                keyboardType="number-pad"
                placeholder="e.g. 400001"
              />
              <Field
                label="Package weight (grams)"
                value={rateWeight}
                onChangeText={setRateWeight}
                keyboardType="number-pad"
                placeholder="500"
              />
              <FormError message={rateError} />
              <PrimaryButton
                title="Check rates"
                variant="ghost"
                onPress={checkRates}
                loading={rateBusy}
                disabled={!registered}
              />
              {!registered && (
                <Text style={[styles.hint, { color: c.textFaint }]}>
                  Save your pickup address first — rates are quoted from its PIN code.
                </Text>
              )}
              {rates !== null &&
                (rates.length === 0 ? (
                  <Text style={[styles.hint, { color: c.textFaint }]}>
                    No couriers serve that route for this weight.
                  </Text>
                ) : (
                  rates.slice(0, 6).map((r) => (
                    <View key={`${r.courierId}`} style={[styles.rateRow, { borderTopColor: c.border }]}>
                      <View style={styles.rateText}>
                        <Text style={[styles.rateName, { color: c.text }]} numberOfLines={1}>
                          {r.name}
                        </Text>
                        <Text style={[styles.rateMeta, { color: c.textFaint }]}>
                          {r.etdDays ? `~${r.etdDays} days` : 'ETA unknown'}
                          {r.rating ? ` · ★ ${r.rating}` : ''}
                        </Text>
                      </View>
                      <Text style={[styles.ratePrice, { color: c.primary }]}>
                        ₹{r.rateRupees.toLocaleString('en-IN')}
                      </Text>
                    </View>
                  ))
                ))}
            </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two + Spacing.one, paddingBottom: 90 },
  body: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 20 },
  hint: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },
  sectionLabel: { fontSize: 11.5, fontFamily: Fonts.sansMedium, letterSpacing: 1.1, marginLeft: 4, marginBottom: -Spacing.one },

  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    backgroundColor: 'rgba(255,196,107,0.06)',
  },
  warnText: { flex: 1, fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },

  okBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.two + Spacing.one,
    backgroundColor: 'rgba(74,222,128,0.08)',
  },
  okText: { flex: 1, fontSize: 13, fontFamily: Fonts.sansMedium },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three + Spacing.one, gap: Spacing.two + Spacing.one },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardName: { flex: 1, fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10.5, fontFamily: Fonts.sansMedium, color: '#4ade80' },

  form: { gap: Spacing.three },
  cancel: { alignSelf: 'center', paddingVertical: Spacing.one, minHeight: 44, justifyContent: 'center' },
  cancelText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },

  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two + 2,
  },
  rateText: { flex: 1, gap: 1 },
  rateName: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
  rateMeta: { fontSize: 11.5, fontFamily: Fonts.sans },
  ratePrice: { fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
});
