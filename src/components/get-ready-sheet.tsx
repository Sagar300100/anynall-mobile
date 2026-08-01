// "Get ready to bid" — mobile port of the web GetReadyModal: one-time setup
// (delivery address, preferred payment method, auction rules) saved to the
// commerce profile. The backend re-validates all of it on every bid, so this
// sheet is a convenience, not a security boundary.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  Field,
  FormError,
  PrimaryButton,
  useBrandColors,
} from '@/components/ui/form';
import { IN_STATES } from '@/constants/in-states';
import { Fonts, Spacing } from '@/constants/theme';
import {
  saveCommerceProfile,
  type CommerceProfile,
  type ShippingAddress,
} from '@/lib/commerce';

interface Props {
  visible: boolean;
  profile: CommerceProfile | null;
  onReady: () => void;
  onClose: () => void;
}

export function GetReadySheet({ visible, profile, onReady, onClose }: Props) {
  const c = useBrandColors();
  const [a, setA] = useState<Partial<ShippingAddress>>({});
  const [method, setMethod] = useState<'upi' | 'card' | ''>('');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [statePickerOpen, setStatePickerOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setA(profile?.savedAddress || {});
    setMethod(profile?.preferredMethod || '');
    setTerms(profile?.auctionTermsAccepted || false);
    setErr(null);
  }, [visible, profile]);

  const set = (k: keyof ShippingAddress) => (v: string) =>
    setA((prev) => ({ ...prev, [k]: v }));

  async function submit() {
    const phone = String(a.phone || '').replace(/\D/g, '');
    const pincode = String(a.pincode || '').trim();
    if (!a.name?.trim() || !a.line1?.trim() || !a.city?.trim())
      return setErr('Name, address and city are required.');
    if (!/^[6-9][0-9]{9}$/.test(phone)) return setErr('Enter a valid 10-digit mobile number.');
    if (!a.stateCode) return setErr('Select your delivery State.');
    if (!/^[1-9][0-9]{5}$/.test(pincode)) return setErr('Enter a valid 6-digit PIN code.');
    if (!method) return setErr('Choose a preferred payment method.');
    if (!terms) return setErr('Please accept the auction purchase rules.');

    const savedAddress: ShippingAddress = {
      name: a.name.trim(),
      phone,
      line1: a.line1.trim(),
      line2: (a.line2 || '').trim(),
      city: a.city.trim(),
      stateCode: a.stateCode,
      pincode,
    };

    setBusy(true);
    setErr(null);
    try {
      await saveCommerceProfile({ savedAddress, preferredMethod: method, acceptAuctionTerms: true });
      onReady();
    } catch (e: any) {
      setErr(String(e?.message || 'Could not save your details. Please retry.').slice(0, 180));
    } finally {
      setBusy(false);
    }
  }

  const stateName = IN_STATES.find((s) => s.code === a.stateCode)?.name;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
            <View style={styles.head}>
              <Text style={[styles.title, { color: c.text }]}>Get ready to bid</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color={c.textSecondary} />
              </Pressable>
            </View>
            <Text style={[styles.sub, { color: c.textSecondary }]}>
              One-time setup — then you're straight back to the show.
            </Text>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[styles.section, { color: c.primary }]}>DELIVERY ADDRESS</Text>
              <Field label="Full name" value={a.name || ''} onChangeText={set('name')} />
              <Field
                label="Mobile number"
                value={a.phone || ''}
                onChangeText={set('phone')}
                keyboardType="number-pad"
                maxLength={10}
              />
              <Field label="House / street" value={a.line1 || ''} onChangeText={set('line1')} />
              <Field label="City" value={a.city || ''} onChangeText={set('city')} />
              <Field
                label="PIN code"
                value={a.pincode || ''}
                onChangeText={set('pincode')}
                keyboardType="number-pad"
                maxLength={6}
              />

              <View style={{ gap: Spacing.one + 2 }}>
                <Text style={[styles.label, { color: c.textSecondary }]}>State / UT</Text>
                <Pressable
                  onPress={() => setStatePickerOpen(true)}
                  style={[styles.stateBtn, { backgroundColor: c.background, borderColor: c.border }]}
                >
                  <Text style={{ color: stateName ? c.text : c.textFaint, fontFamily: Fonts.sans, fontSize: 16 }}>
                    {stateName || 'Select State / UT'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={c.textSecondary} />
                </Pressable>
              </View>

              <Text style={[styles.section, { color: c.primary }]}>PREFERRED PAYMENT METHOD</Text>
              <View style={styles.methods}>
                {(['upi', 'card'] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMethod(m)}
                    style={[
                      styles.method,
                      {
                        borderColor: method === m ? c.primary : c.border,
                        backgroundColor: method === m ? c.backgroundSelected : c.background,
                      },
                    ]}
                  >
                    <Text style={[styles.methodTitle, { color: c.text }]}>
                      {m === 'upi' ? 'UPI' : 'Card'}
                    </Text>
                    <Text style={[styles.methodSub, { color: c.textSecondary }]}>
                      {m === 'upi' ? 'Approve in your UPI app' : 'Via Razorpay & your bank'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable onPress={() => setTerms((t) => !t)} style={styles.terms}>
                <Ionicons
                  name={terms ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={terms ? c.primary : c.textSecondary}
                />
                <Text style={[styles.termsText, { color: c.textSecondary }]}>
                  I understand each winning bid is a purchase commitment — I'll pay within the
                  payment window or my bidding may be paused.
                </Text>
              </Pressable>

              <FormError message={err} />
              <PrimaryButton title="Save & continue" onPress={submit} loading={busy} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>

      {/* State picker overlay */}
      <Modal visible={statePickerOpen} animationType="fade" transparent onRequestClose={() => setStatePickerOpen(false)}>
        <Pressable style={styles.pickerScrim} onPress={() => setStatePickerOpen(false)}>
          <View style={[styles.picker, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
            <FlatList
              data={IN_STATES}
              keyExtractor={(s) => s.code}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    set('stateCode')(item.code);
                    setStatePickerOpen(false);
                  }}
                  style={[styles.pickerRow, { borderColor: c.border }]}
                >
                  <Text style={{ color: c.text, fontFamily: Fonts.sans, fontSize: 15 }}>{item.name}</Text>
                  {a.stateCode === item.code && <Ionicons name="checkmark" size={16} color={c.primary} />}
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(2,6,16,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingTop: Spacing.three,
    maxHeight: '92%',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  title: { fontSize: 20, fontFamily: Fonts.sansSemiBold },
  sub: { fontSize: 13, fontFamily: Fonts.sans, paddingHorizontal: Spacing.three, marginTop: 2 },
  scroll: { marginTop: Spacing.two },
  scrollContent: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
  section: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 2 },
  label: { fontSize: 13, fontFamily: Fonts.sansMedium },
  stateBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  methods: { flexDirection: 'row', gap: Spacing.two },
  method: { flex: 1, borderWidth: 1, borderRadius: 8, padding: Spacing.three, gap: 2 },
  methodTitle: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  methodSub: { fontSize: 12, fontFamily: Fonts.sans },
  terms: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  termsText: { flex: 1, fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },
  pickerScrim: {
    flex: 1,
    backgroundColor: 'rgba(2,6,16,0.72)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  picker: { borderWidth: 1, borderRadius: 12, maxHeight: '70%', overflow: 'hidden' },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
