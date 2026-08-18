// Delivery address — first-class settings screen for the buyer's saved
// address (users/{uid}.commerce.savedAddress via GET/POST
// /api/commerce/profile).
//
// PARITY NOTE — the website's AddressesPanel is a LOCAL-STATE MOCK (hardcoded
// list, nothing persists) and the backend stores exactly ONE saved address:
// the one every checkout, bid-readiness check and same-State tax rule reads.
// So this screen manages that one real address properly instead of faking an
// address book the platform doesn't have. Until now the only way to edit it
// was mid-checkout inside the Get-Ready sheet; settings deserves a calm,
// full-screen editor.
//
// Validation mirrors functions/auctionsRouter.js validShipping() exactly:
// name/line1/city required, phone /^[6-9]\d{9}$/, PIN /^[1-9]\d{5}$/, and a
// GST State/UT code — the State matters beyond delivery, because same-State
// tax rules decide which sellers may sell to this buyer at all.
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
import {
  getCommerceProfile,
  saveCommerceProfile,
  type ShippingAddress,
} from '@/lib/commerce';
import { IN_STATES } from '@/lib/seller';

export default function AddressScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // null = no address saved yet; the screen opens straight into the form.
  const [saved, setSaved] = useState<ShippingAddress | null>(null);
  const [editing, setEditing] = useState(false);

  const [form, setForm] = useState<Partial<ShippingAddress>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (status !== 'member') return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getCommerceProfile();
        if (cancelled) return;
        setSaved(p.savedAddress);
        setForm(p.savedAddress || {});
        setEditing(!p.savedAddress); // nothing saved → open the form directly
        setLoadError(false);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const set = (k: keyof ShippingAddress) => (v: string) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  };

  async function submit() {
    // Same order and same rules as the server's validShipping().
    const phone = String(form.phone || '').replace(/\D/g, '');
    const pincode = String(form.pincode || '').trim();
    if (!form.name?.trim() || !form.line1?.trim() || !form.city?.trim()) {
      setError('Name, address and city are required.');
      return;
    }
    if (!/^[6-9][0-9]{9}$/.test(phone)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (!form.stateCode) {
      setError('Select your delivery State.');
      return;
    }
    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
      setError('Enter a valid 6-digit PIN code.');
      return;
    }

    const savedAddress: ShippingAddress = {
      name: form.name.trim(),
      phone,
      line1: form.line1.trim(),
      line2: (form.line2 || '').trim(),
      city: form.city.trim(),
      stateCode: form.stateCode,
      pincode,
    };

    setBusy(true);
    setError(null);
    try {
      await saveCommerceProfile({ savedAddress });
      setSaved(savedAddress);
      setEditing(false);
      setJustSaved(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.slice(0, 180)
          : 'Could not save your address. Please retry.'
      );
    } finally {
      setBusy(false);
    }
  }

  const stateName = IN_STATES.find((s) => s.code === saved?.stateCode)?.name;

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
        <Text style={[styles.topTitle, { color: c.text }]}>Delivery address</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="location-outline"
          title="Sign in to save your address"
          body="Your delivery address speeds up checkout and tells us which sellers can ship to you."
          reason="profile"
        />
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : loadError ? (
        <View style={styles.center}>
          <Text style={[styles.body, { color: c.textSecondary }]}>
            Couldn’t load your address. Check your connection and try again.
          </Text>
        </View>
      ) : !editing && saved ? (
        /* ── Saved view ── */
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {justSaved && (
            <View style={[styles.okBox, { borderColor: 'rgba(74,222,128,0.35)' }]}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#4ade80" />
              <Text style={[styles.okText, { color: '#4ade80' }]}>Address saved</Text>
            </View>
          )}
          <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            <View style={styles.cardHead}>
              <Ionicons name="home-outline" size={18} color={c.primary} />
              <Text style={[styles.cardName, { color: c.text }]}>{saved.name}</Text>
              <View style={[styles.defaultBadge, { borderColor: 'rgba(74,143,229,0.4)' }]}>
                <Text style={[styles.defaultBadgeText, { color: c.primary }]}>Delivery</Text>
              </View>
            </View>
            <Text style={[styles.body, { color: c.textSecondary }]}>
              {saved.line1}
              {saved.line2 ? `\n${saved.line2}` : ''}
              {`\n${saved.city}, ${stateName || saved.stateCode} ${saved.pincode}`}
            </Text>
            <View style={[styles.phoneRow, { borderTopColor: c.border }]}>
              <Ionicons name="call-outline" size={14} color={c.textFaint} />
              <Text style={[styles.phoneText, { color: c.textSecondary }]}>+91 {saved.phone}</Text>
            </View>
          </View>

          <Text style={[styles.note, { color: c.textFaint }]}>
            This address is used at every checkout, and its State decides which sellers can sell to
            you — some sellers may only deliver within their own State under GST rules.
          </Text>

          <PrimaryButton
            title="Edit address"
            variant="ghost"
            onPress={() => {
              setForm(saved);
              setJustSaved(false);
              setEditing(true);
            }}
          />
        </ScrollView>
      ) : (
        /* ── Edit form ── */
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Field
              label="Full name"
              value={form.name || ''}
              onChangeText={set('name')}
              autoComplete="name"
              textContentType="name"
            />
            <Field
              label="Mobile number"
              value={form.phone || ''}
              onChangeText={set('phone')}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              placeholder="10-digit mobile"
            />
            <Field
              label="Address line 1"
              value={form.line1 || ''}
              onChangeText={set('line1')}
              autoComplete="street-address"
              placeholder="House / flat, street"
            />
            <Field
              label="Address line 2 (optional)"
              value={form.line2 || ''}
              onChangeText={set('line2')}
              placeholder="Area, landmark"
            />
            <Field label="City" value={form.city || ''} onChangeText={set('city')} />
            <StatePicker
              label="State / Union Territory"
              value={form.stateCode || ''}
              onChange={(code) => setForm((prev) => ({ ...prev, stateCode: code }))}
            />
            <Field
              label="PIN code"
              value={form.pincode || ''}
              onChangeText={set('pincode')}
              keyboardType="number-pad"
              autoComplete="postal-code"
              textContentType="postalCode"
              placeholder="6-digit PIN"
            />
            <FormError message={error} />
            <PrimaryButton title="Save address" onPress={submit} loading={busy} />
            {saved && (
              <Pressable
                onPress={() => {
                  setEditing(false);
                  setError(null);
                }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Cancel editing"
                style={({ pressed }) => [styles.cancel, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.cancelText, { color: c.textSecondary }]}>Cancel</Text>
              </Pressable>
            )}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },

  scroll: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.three, paddingBottom: Spacing.six },
  body: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 21 },
  note: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },

  okBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.two + Spacing.one,
    backgroundColor: 'rgba(74,222,128,0.08)',
  },
  okText: { fontSize: 13, fontFamily: Fonts.sansMedium },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three + Spacing.one, gap: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardName: { flex: 1, fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  defaultBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  defaultBadgeText: { fontSize: 10.5, fontFamily: Fonts.sansMedium },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two + 2,
    marginTop: Spacing.one,
  },
  phoneText: { fontSize: 13, fontFamily: Fonts.sans },

  cancel: { alignSelf: 'center', paddingVertical: Spacing.one, minHeight: 44, justifyContent: 'center' },
  cancelText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
});
