// Seller onboarding wizard — mobile port of the web BecomeSellerPage.tsx.
// Same nine steps, same server contracts, same copy. Progress is saved on the
// server after every step, so leaving and returning resumes correctly.
//
// DigiLocker is a browser round trip: the server fixes the redirect to
// anynall.com, which a native app can't intercept — so the app opens the
// GoI flow in a browser tab, keeps the sessionId, and completes verification
// itself when the user returns ("I've finished" button).
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AgreementScreen } from '@/components/agreement-screen';
import { ReviewScreen } from '@/components/review-screen';
import { BankDetailsScreen } from '@/components/bank-details-screen';
import { EnrolmentScreen } from '@/components/enrolment-screen';
import { GstDetailsScreen } from '@/components/gst-details-screen';
import { IdentityScreen } from '@/components/identity-screen';
import { PanDetailsScreen } from '@/components/pan-details-screen';
import { StoreInfoScreen } from '@/components/store-info-screen';
import { TaxDetailsScreen } from '@/components/tax-details-screen';
import { PrimaryButton, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  firstIncompleteStep,
  ONBOARDING_STEPS,
  type SellerOnboardingState,
  type StepKey,
} from '@/lib/seller';

// The real steps (shared with Store Info's progress bar) plus the outcome
// screen, which is shown as a chip but isn't a step the seller works through.
const STEPS: { key: StepKey; label: string }[] = [
  ...ONBOARDING_STEPS,
  { key: 'welcome', label: 'Done' },
];

// ── Small shared pieces ────────────────────────────────────────────────────

function StepHeading({ title, sub }: { title: string; sub: string }) {
  const c = useBrandColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.stepTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.stepSub, { color: c.textSecondary }]}>{sub}</Text>
    </View>
  );
}

function NoteBox({
  kind,
  title,
  body,
}: {
  kind: 'success' | 'pending' | 'warn';
  title: string;
  body?: string;
}) {
  const c = useBrandColors();
  const tint =
    kind === 'success' ? '#34D399' : kind === 'pending' ? '#E8B03F' : 'rgba(230,57,70,0.9)';
  const icon =
    kind === 'success' ? 'checkmark-circle-outline' : kind === 'pending' ? 'time-outline' : 'alert-circle-outline';
  return (
    <View style={[styles.note, { borderColor: `${tint}55`, backgroundColor: c.cardBackground }]}>
      <Ionicons name={icon} size={18} color={tint} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.noteTitle, { color: c.text }]}>{title}</Text>
        {!!body && <Text style={[styles.noteBody, { color: c.textSecondary }]}>{body}</Text>}
      </View>
    </View>
  );
}

// ── The wizard ─────────────────────────────────────────────────────────────

export function SellerWizard({
  state,
  onRefresh,
  onDone,
  onExit,
}: {
  state: SellerOnboardingState;
  onRefresh: () => Promise<void>;
  /** Called when an approved seller taps "Go to Seller Hub". */
  onDone: () => void;
  /** Back out of the flow, to the Seller Hub intro. */
  onExit: () => void;
}) {
  const c = useBrandColors();
  const [step, setStep] = useState<StepKey>(() => firstIncompleteStep(state));
  const scrollRef = useRef<ScrollView>(null);

  function go(next: StepKey) {
    setStep(next);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  const gstLabel = state.taxStatus === 'unregistered_enrolled' ? 'Enrolment' : 'GST';
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  // Store Info owns its whole screen (header + progress + CTA), so it renders
  // standalone rather than inside the wizard's card chrome.
  // Steps rebuilt as standalone screens own their whole viewport (header +
  // progress + CTA), so they render outside the wizard's card chrome.
  if (step === 'store') {
    return (
      <StoreInfoScreen
        initialName={state.storeName}
        initialPhotoUrl={state.storePhotoUrl ?? null}
        onStepPress={go}
        onDone={async () => {
          await onRefresh();
          go(state.storeSetupComplete ? firstIncompleteStep(state) : 'tax');
        }}
      />
    );
  }

  if (step === 'tax') {
    return (
      <TaxDetailsScreen
        state={state}
        onStepPress={go}
        onDone={async () => {
          await onRefresh();
          go('aadhaar');
        }}
      />
    );
  }

  if (step === 'aadhaar') {
    return (
      <IdentityScreen
        state={state}
        onStepPress={go}
        onDone={async () => {
          await onRefresh();
          go('pan');
        }}
      />
    );
  }

  if (step === 'pan') {
    return (
      <PanDetailsScreen
        state={state}
        onStepPress={go}
        onDone={async () => {
          await onRefresh();
          go('gst');
        }}
      />
    );
  }

  if (step === 'review') {
    return (
      <ReviewScreen
        state={state}
        onStepPress={go}
        onSubmitted={onRefresh}
        onDone={onExit}
      />
    );
  }

  if (step === 'agreement') {
    return (
      <AgreementScreen
        state={state}
        onStepPress={go}
        onRefresh={onRefresh}
        onDone={async () => {
          await onRefresh();
          go('review');
        }}
      />
    );
  }

  if (step === 'bank') {
    return (
      <BankDetailsScreen
        state={state}
        onStepPress={go}
        onDone={async () => {
          // Re-reads onboarding state from the backend, so navigation follows
          // the server's verification status rather than a local flag.
          await onRefresh();
          go('agreement');
        }}
      />
    );
  }

  // The tax-registration step branches on the seller's declared status:
  // GSTIN verification for registered sellers, enrolment for the rest.
  if (step === 'gst') {
    const next = async () => {
      await onRefresh();
      go('bank');
    };
    return state.taxStatus === 'unregistered_enrolled' ? (
      <EnrolmentScreen state={state} onStepPress={go} onDone={next} />
    ) : (
      <GstDetailsScreen state={state} onStepPress={go} onDone={next} />
    );
  }

  return (
    <>
    {/* Own header — the Sell tab hides its own while the flow is open.
        No back button: completed steps are reachable from the chips below. */}
    <View style={styles.topBar}>
      <Text style={[styles.topTitle, { color: c.text }]}>Seller Hub</Text>
    </View>
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.eyebrow, { color: c.primary }]}>BECOME A SELLER</Text>
      <Text style={[styles.h1, { color: c.text }]}>Set up your store on Any & All</Text>
      <Text style={[styles.h1Sub, { color: c.textSecondary }]}>
        Takes about 10 minutes. Your progress is saved after every step.
      </Text>

      {/* Step chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {STEPS.map((s, i) => {
          const active = s.key === step;
          const done = i < stepIndex;
          // Completed steps stay editable; later ones can't be skipped into.
          const reachable = done;
          return (
            <Pressable
              key={s.key}
              onPress={reachable ? () => go(s.key) : undefined}
              disabled={!reachable}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !reachable }}
              accessibilityLabel={`${s.key === 'gst' ? gstLabel : s.label} step`}
              style={({ pressed }) => [
                styles.chip,
                { borderColor: active ? c.primary : c.border },
                active && { backgroundColor: 'rgba(74,143,229,0.14)' },
                pressed && reachable && { opacity: 0.7 },
              ]}
            >
              {done && <Ionicons name="checkmark" size={11} color={c.primary} />}
              <Text
                style={[
                  styles.chipText,
                  { color: active || done ? c.primary : c.textSecondary },
                ]}
              >
                {s.key === 'gst' ? gstLabel : s.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
        {step === 'welcome' && <WelcomeStep state={state} onDone={onDone} />}
      </View>
    </ScrollView>
    </>
  );
}

// ── Step 9: Welcome / status ───────────────────────────────────────────────
function WelcomeStep({ state, onDone }: { state: SellerOnboardingState; onDone: () => void }) {
  if (state.applicationStatus === 'approved') {
    return (
      <View style={styles.stepBody}>
        <StepHeading
          title={`Your seller account is ready${state.storeName ? `, ${state.storeName}` : ''}!`}
          sub="You can now list products and host live shows. Payouts release after each order completes per the payout policy."
        />
        <NoteBox kind="success" title="Application approved" />
        <PrimaryButton title="Go to Seller Hub" onPress={onDone} />
      </View>
    );
  }
  if (state.applicationStatus === 'action_required') {
    return (
      <View style={styles.stepBody}>
        <StepHeading
          title="We need additional information."
          sub="Our team has flagged something in your application. Check your email, or contact seller support."
        />
        <NoteBox kind="warn" title="Action required" />
      </View>
    );
  }
  return (
    <View style={styles.stepBody}>
      <StepHeading
        title="Your application is under review."
        sub="Everything is submitted. Our compliance team reviews tax details (usually within 1–2 working days) — we’ll email you when selling is enabled."
      />
      <NoteBox kind="pending" title="Pending review" />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    minHeight: 46,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 21, fontFamily: Fonts.sansSemiBold },
  scroll: { padding: Spacing.three, paddingTop: Spacing.one, paddingBottom: Spacing.five, gap: Spacing.three },
  eyebrow: { fontSize: 11.5, fontFamily: Fonts.sansSemiBold, letterSpacing: 1.4 },
  h1: { fontSize: 23, fontFamily: Fonts.sansSemiBold, lineHeight: 29 },
  h1Sub: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 19 },
  chips: { gap: Spacing.one + 2, paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipText: { fontSize: 11.5, fontFamily: Fonts.sansMedium },
  card: { borderWidth: 1, borderRadius: 18, padding: Spacing.three },
  stepBody: { gap: Spacing.three },
  stepTitle: { fontSize: 18, fontFamily: Fonts.sansSemiBold },
  stepSub: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18.5 },

  note: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.two + Spacing.one,
    alignItems: 'flex-start',
  },
  noteTitle: { fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  noteBody: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17.5 },

  checkRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start', paddingVertical: 6 },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkText: { flex: 1, fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17.5 },

  radioCard: {
    flexDirection: 'row',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.two + Spacing.one,
    alignItems: 'flex-start',
  },
  radioDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioDotInner: { width: 9, height: 9, borderRadius: 5 },
  radioTitle: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
  radioDesc: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17 },

  pickerLabel: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    minHeight: 46,
  },
  fieldHint: { fontSize: 11.5, fontFamily: Fonts.sans },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(2,5,14,0.6)' },
  modalSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  modalTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  modalRow: { paddingVertical: 12, borderRadius: 8, paddingHorizontal: 6 },

  agreementBox: { borderWidth: 1, borderRadius: 12, padding: Spacing.two + Spacing.one },
  agreementH: { fontSize: 14, fontFamily: Fonts.sansSemiBold, marginBottom: 8 },
  agreementP: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18.5, marginBottom: 6 },
  agreementLink: { fontSize: 13, fontFamily: Fonts.sansMedium, marginTop: 8, marginBottom: 4 },
  agreementEnd: { fontSize: 11.5, fontFamily: Fonts.sans, textAlign: 'center', marginVertical: 8 },
  scrollHint: { fontSize: 12, fontFamily: Fonts.sans, textAlign: 'center' },

  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reviewLabel: { fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  reviewValue: { fontSize: 12.5, fontFamily: Fonts.sans },
});
