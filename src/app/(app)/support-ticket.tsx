// Raise a Ticket — mobile port of the website's pages/SupportTicketPage.tsx.
//
// Same 3-step shape, same real backend (POST /api/support/ticket →
// supportTickets + queue routing), same category-specific step-3 fields from
// the founder's support spec. No fake local tickets, and attachments stay an
// honest "not yet" line rather than a dead picker (no upload pipeline exists
// for support).
//
// Signed-out users CAN submit — "I can't log in" is a support category — so
// this screen never sits behind an auth gate.
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
import { auth } from '@/lib/firebase';
import {
  submitTicket,
  TicketValidationError,
  type TicketCategory,
} from '@/lib/support';

const CATEGORIES: { key: TicketCategory; label: string; hint: string }[] = [
  { key: 'order_issue', label: 'Order issue', hint: 'Wrong, missing or stuck orders' },
  { key: 'refund_return', label: 'Refund / return', hint: 'Money back or send it back' },
  { key: 'payment_issue', label: 'Payment issue', hint: 'Deductions, double charges' },
  { key: 'delivery_issue', label: 'Delivery issue', hint: 'Late, lost or failed delivery' },
  { key: 'seller_issue', label: 'Seller issue', hint: 'KYC, payouts, listings, fees' },
  { key: 'account_login', label: 'Account / login issue', hint: 'Access, OTP, profile' },
  { key: 'live_show', label: 'Live show issue', hint: 'Stream, bidding, chat' },
  { key: 'privacy_data', label: 'Privacy / data request', hint: 'Deletion, correction, access' },
  { key: 'grievance_safety', label: 'Grievance / safety complaint', hint: 'Formal or safety complaints' },
  { key: 'other', label: 'Other', hint: 'Anything else' },
];

type DetailField = {
  key: string;
  label: string;
  type: 'text' | 'select' | 'textarea';
  options?: string[];
  placeholder?: string;
};

// Step-3 fields per category — mirrors the website / support spec exactly.
// All optional server-side; the queue team asks follow-ups on the thread.
const DETAIL_FIELDS: Record<TicketCategory, DetailField[]> = {
  order_issue: [
    { key: 'order_id', label: 'Order ID', type: 'text', placeholder: 'e.g. ORD-1024' },
    { key: 'store_name', label: 'Seller / store name', type: 'text' },
    { key: 'product_name', label: 'Product name', type: 'text' },
    { key: 'what_happened', label: 'What happened?', type: 'textarea' },
    { key: 'preferred_resolution', label: 'Preferred resolution', type: 'select', options: ['Refund', 'Return', 'Replacement', 'Missing item help', 'Delivery update', 'Other'] },
  ],
  refund_return: [
    { key: 'order_id', label: 'Order ID', type: 'text', placeholder: 'e.g. ORD-1024' },
    { key: 'store_name', label: 'Seller / store name', type: 'text' },
    { key: 'product_name', label: 'Product name', type: 'text' },
    { key: 'what_happened', label: 'What happened?', type: 'textarea' },
    { key: 'preferred_resolution', label: 'Preferred resolution', type: 'select', options: ['Refund', 'Return', 'Replacement', 'Missing item help', 'Delivery update', 'Other'] },
  ],
  delivery_issue: [
    { key: 'order_id', label: 'Order ID', type: 'text', placeholder: 'e.g. ORD-1024' },
    { key: 'store_name', label: 'Seller / store name', type: 'text' },
    { key: 'product_name', label: 'Product name', type: 'text' },
    { key: 'what_happened', label: 'What happened?', type: 'textarea' },
    { key: 'preferred_resolution', label: 'Preferred resolution', type: 'select', options: ['Refund', 'Return', 'Replacement', 'Missing item help', 'Delivery update', 'Other'] },
  ],
  payment_issue: [
    { key: 'payment_ref', label: 'Payment ID / UPI reference', type: 'text' },
    { key: 'order_id', label: 'Order ID (if available)', type: 'text' },
    { key: 'amount_paid', label: 'Amount paid (₹)', type: 'text' },
    { key: 'payment_date', label: 'Payment date', type: 'text', placeholder: 'e.g. 9 July 2026' },
    { key: 'payment_issue_type', label: 'Issue type', type: 'select', options: ['Payment deducted but order not confirmed', 'Double payment', 'Refund not received', 'Wrong amount charged', 'Other'] },
  ],
  seller_issue: [
    { key: 'store_name', label: 'Store name', type: 'text' },
    { key: 'seller_contact', label: 'Registered seller email / mobile', type: 'text' },
    { key: 'seller_issue_type', label: 'Issue type', type: 'select', options: ['KYC / verification', 'Payout', 'Product listing', 'Live show', 'Logistics', 'Fees / charges', 'Account restriction', 'Other'] },
    { key: 'related_id', label: 'Related order / listing / payout ID (if any)', type: 'text' },
  ],
  live_show: [
    { key: 'show_ref', label: 'Show ID / show title', type: 'text' },
    { key: 'store_name', label: 'Seller / store name', type: 'text' },
    { key: 'show_datetime', label: 'Date and time of show', type: 'text', placeholder: 'e.g. 9 July, 9:00 PM' },
    { key: 'show_issue_type', label: 'Issue type', type: 'select', options: ['Stream not working', 'Audio/video issue', 'Bidding issue', 'Chat issue', 'Product pinning issue', 'Viewer issue', 'Other'] },
  ],
  account_login: [
    { key: 'account_contact', label: 'Registered email / mobile', type: 'text' },
    { key: 'can_access', label: 'Can you access your account?', type: 'select', options: ['Yes', 'No'] },
    { key: 'account_issue_type', label: 'Issue type', type: 'select', options: ['Cannot login', 'OTP/email issue', 'Account locked', 'Wrong profile details', 'Delete account', 'Change email/mobile', 'Other'] },
  ],
  privacy_data: [
    { key: 'request_type', label: 'Request type', type: 'select', options: ['Account deletion', 'Data correction', 'Data access request', 'Consent withdrawal', 'Privacy concern', 'Other'] },
    { key: 'account_contact', label: 'Registered email / mobile', type: 'text' },
    { key: 'request_details', label: 'Details of request', type: 'textarea' },
  ],
  grievance_safety: [
    { key: 'complaint_type', label: 'Complaint type', type: 'select', options: ['Unresolved support issue', 'User safety concern', 'Privacy grievance', 'Fraud / scam concern', 'Policy violation', 'Legal complaint', 'Other'] },
    { key: 'account_contact', label: 'Registered email / mobile', type: 'text' },
    { key: 'related_id', label: 'Order ID or account details (if applicable)', type: 'text' },
    { key: 'complaint_details', label: 'Clear description', type: 'textarea' },
  ],
  other: [],
};

const QUEUE_NOTE: Partial<Record<TicketCategory, string>> = {
  privacy_data:
    'Privacy and data requests are handled under our privacy process (privacy@anynall.com).',
  grievance_safety:
    'Grievance and safety complaints are reviewed under our grievance process (grievance@anynall.com).',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function SupportTicketScreen() {
  const c = useBrandColors();
  const u = auth.currentUser;

  const [step, setStep] = useState(1);
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [name, setName] = useState((u?.displayName || '').trim());
  const [email, setEmail] = useState(u?.email || '');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState<{ ticketId: string } | null>(null);

  // Mirrors the server's own validation so the round trip almost never fails —
  // but TicketValidationError below still maps a server rejection field-by-field.
  function validateStep2() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Full name is required.';
    if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.';
    if (subject.trim().length < 3) e.subject = 'Subject is required.';
    if (description.trim().length < 10)
      e.description = 'Please describe your issue (at least 10 characters).';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!category || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await submitTicket({
        category,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        subject: subject.trim(),
        description: description.trim(),
        details,
      });
      setDone({ ticketId: res.ticketId });
    } catch (err) {
      if (err instanceof TicketValidationError) {
        setErrors(err.fields);
        setStep(2); // the offending fields live on step 2
      }
      setSubmitError(err instanceof Error ? err.message : 'Could not submit your ticket.');
    } finally {
      setSubmitting(false);
    }
  }

  function goBack() {
    // From step 2/3 Back means "previous step", not "leave the form" — losing
    // a half-written description to a mis-tap is exactly the frustration a
    // support form must not add.
    if (!done && step > 1) {
      setStep(step - 1);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/help');
  }

  const fields = category ? DETAIL_FIELDS[category] : [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Raise a Ticket</Text>
        {!done && (
          <Text style={[styles.stepBadge, { color: c.textSecondary }]}>Step {step} of 3</Text>
        )}
      </View>

      {done ? (
        <View style={styles.doneWrap}>
          <View style={[styles.doneRing, { borderColor: 'rgba(74,222,128,0.4)' }]}>
            <Ionicons name="checkmark" size={30} color="#4ade80" />
          </View>
          <Text style={[styles.doneTitle, { color: c.text }]}>Ticket submitted</Text>
          <Text style={[styles.doneId, { color: c.primary }]}>{done.ticketId}</Text>
          <Text style={[styles.doneBody, { color: c.textSecondary }]}>
            {/* No confirmation email exists — the backend only notifies the
                support queue — so never claim one was sent. Replies from the
                team DO go to the address provided. */}
            We’ve received your request — the team will reply to {email.trim()}. Keep this ID for
            follow-ups, and track replies under My Tickets.
          </Text>
          <View style={styles.doneActions}>
            <PrimaryButton title="View my tickets" onPress={() => router.replace('/my-tickets')} />
            <PrimaryButton
              title="Back to Help Center"
              variant="ghost"
              onPress={() => router.replace('/help')}
            />
          </View>
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
            {step === 1 && (
              <>
                <Text style={[styles.stepTitle, { color: c.text }]}>
                  What do you need help with?
                </Text>
                <View style={styles.catList}>
                  {CATEGORIES.map((cat) => {
                    const active = category === cat.key;
                    return (
                      <Pressable
                        key={cat.key}
                        onPress={() => {
                          setCategory(cat.key);
                          setDetails({});
                          setStep(2);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={cat.label}
                        accessibilityHint={cat.hint}
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [
                          styles.catRow,
                          {
                            backgroundColor: c.cardBackground,
                            borderColor: active ? c.primary : c.border,
                          },
                          pressed && { opacity: 0.75 },
                        ]}
                      >
                        <View style={styles.catText}>
                          <Text style={[styles.catLabel, { color: c.text }]}>{cat.label}</Text>
                          <Text style={[styles.catHint, { color: c.textSecondary }]}>
                            {cat.hint}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {step === 2 && (
              <>
                <Text style={[styles.stepTitle, { color: c.text }]}>Your details</Text>
                <View style={styles.form}>
                  <Field
                    label="Full name"
                    value={name}
                    onChangeText={setName}
                    error={errors.name}
                    autoComplete="name"
                    textContentType="name"
                  />
                  <Field
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    error={errors.email}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    textContentType="emailAddress"
                  />
                  <Field
                    label="Mobile (optional)"
                    value={phone}
                    onChangeText={setPhone}
                    error={errors.phone}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                  />
                  <Field
                    label="Subject"
                    value={subject}
                    onChangeText={setSubject}
                    error={errors.subject}
                    placeholder="One line summing up the issue"
                  />
                  <Field
                    label="Describe your issue"
                    value={description}
                    onChangeText={setDescription}
                    error={errors.description}
                    placeholder="What happened, and what would fix it for you?"
                    multiline
                    numberOfLines={5}
                    style={styles.textarea}
                  />
                  <PrimaryButton
                    title="Continue"
                    onPress={() => {
                      if (validateStep2()) setStep(3);
                    }}
                  />
                </View>
              </>
            )}

            {step === 3 && category && (
              <>
                <Text style={[styles.stepTitle, { color: c.text }]}>
                  {fields.length ? 'A few specifics' : 'Review and submit'}
                </Text>
                {!!QUEUE_NOTE[category] && (
                  <Text style={[styles.queueNote, { color: c.textSecondary }]}>
                    {QUEUE_NOTE[category]}
                  </Text>
                )}
                <View style={styles.form}>
                  {fields.map((f) =>
                    f.type === 'select' ? (
                      <View key={f.key} style={styles.selectWrap}>
                        <Text style={[styles.selectLabel, { color: c.textSecondary }]}>
                          {f.label}
                        </Text>
                        <View style={styles.optionWrap}>
                          {(f.options || []).map((opt) => {
                            const active = details[f.key] === opt;
                            return (
                              <Pressable
                                key={opt}
                                onPress={() =>
                                  setDetails((d) => ({ ...d, [f.key]: active ? '' : opt }))
                                }
                                accessibilityRole="button"
                                accessibilityLabel={opt}
                                accessibilityState={{ selected: active }}
                                style={[
                                  styles.option,
                                  active
                                    ? { backgroundColor: c.cta, borderColor: c.cta }
                                    : { borderColor: c.border },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.optionText,
                                    { color: active ? c.ctaText : c.textSecondary },
                                  ]}
                                >
                                  {opt}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    ) : (
                      <Field
                        key={f.key}
                        label={f.label}
                        value={details[f.key] || ''}
                        onChangeText={(v) => setDetails((d) => ({ ...d, [f.key]: v }))}
                        placeholder={f.placeholder}
                        multiline={f.type === 'textarea'}
                        numberOfLines={f.type === 'textarea' ? 4 : 1}
                        style={f.type === 'textarea' ? styles.textarea : undefined}
                      />
                    )
                  )}

                  {/* Honest, like the website: no upload pipeline exists yet. */}
                  <View style={[styles.attach, { borderColor: c.border }]}>
                    <Ionicons name="attach-outline" size={16} color={c.textFaint} />
                    <Text style={[styles.attachText, { color: c.textFaint }]}>
                      Attachments aren’t supported yet — reply to the ticket email with screenshots
                      or proof.
                    </Text>
                  </View>

                  <FormError message={submitError || null} />
                  <PrimaryButton title="Submit ticket" onPress={handleSubmit} loading={submitting} />
                </View>
              </>
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
  stepBadge: { fontSize: 12, fontFamily: Fonts.sansMedium },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, paddingBottom: Spacing.six },
  stepTitle: { fontSize: 21, fontFamily: Fonts.sansSemiBold, marginBottom: Spacing.three },
  queueNote: {
    fontSize: 13,
    fontFamily: Fonts.sans,
    lineHeight: 19,
    marginTop: -Spacing.two,
    marginBottom: Spacing.three,
  },

  catList: { gap: Spacing.two },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    minHeight: 58,
  },
  catText: { flex: 1, gap: 1 },
  catLabel: { fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  catHint: { fontSize: 12.5, fontFamily: Fonts.sans },

  form: { gap: Spacing.three },
  textarea: { minHeight: 110, textAlignVertical: 'top' },

  selectWrap: { gap: Spacing.one + 2 },
  selectLabel: { fontSize: 13, fontFamily: Fonts.sansMedium },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  option: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    minHeight: 40,
    justifyContent: 'center',
  },
  optionText: { fontSize: 13, fontFamily: Fonts.sansMedium },

  attach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: Spacing.three,
  },
  attachText: { flex: 1, fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },

  doneWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  doneRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  doneTitle: { fontSize: 20, fontFamily: Fonts.sansSemiBold },
  doneId: { fontSize: 15, fontFamily: Fonts.mono, letterSpacing: 1 },
  doneBody: {
    fontSize: 13.5,
    fontFamily: Fonts.sans,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 320,
  },
  doneActions: { alignSelf: 'stretch', maxWidth: 340, gap: Spacing.two, marginTop: Spacing.three },
});
