// Step 5 — GST-portal enrolment, for sellers who chose "Not GST registered".
//
// Any&All cannot enrol anyone: the enrolment number is issued by the GST
// portal and only the seller can obtain it. So this screen does two jobs —
// walk them through getting it on gst.gov.in, then collect and submit it.
//
// HONEST STATE: our GST provider (Cashfree Verification Suite) verifies
// GSTINs, not the enrolment ids issued to unregistered e-commerce suppliers,
// and no other public API does either. So this submission is queued for
// compliance review and is NEVER labelled verified on the strength of its
// format. The declarations are the legally material part and are stored
// per-key with a version stamp.
//
// This page is intentionally long. Do not compress it to one viewport.
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingStepHeader } from '@/components/onboarding-step-header';
import { StatePicker } from '@/components/state-picker';
import {
  Card,
  CardTitle,
  ChoiceRow,
  CheckRow,
  DetailRow,
  FieldLabel,
  GhostButton,
  Note,
  PrimaryCta,
  StatusPanel,
  Step5Hero,
  TAB_BAR_CLEARANCE,
  step5Styles,
} from '@/components/step5-parts';
import { Field, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  ENROLMENT_DECLARATIONS,
  ENROLMENT_RE,
  IN_STATES,
  NO_DECLARATIONS,
  TURNOVER_BANDS,
  normaliseTaxId,
  sellerErrorCode,
  submitEnrolment,
  type Declarations,
  type SellerOnboardingState,
  type StepKey,
  type TurnoverBand,
} from '@/lib/seller';

const GST_PORTAL = 'https://www.gst.gov.in/';

/** Draft key. Holds only the non-identifying answers — the enrolment number
 *  is a tax identifier and is never written to unencrypted device storage. */
const DRAFT_KEY = 'anynall:enrolment-draft';

const HOW_TO = [
  'Sign in at gst.gov.in',
  'Go to Services → User Services',
  'Open “Enrolment for supply through e-commerce operators”',
  'Complete the process and copy the enrolment number issued by the GST portal',
];

const stateName = (code?: string | null) => IN_STATES.find((s) => s.code === code)?.name ?? null;
const bandLabel = (b?: string | null) => TURNOVER_BANDS.find((t) => t.value === b)?.label ?? null;

function formatWhen(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function EnrolmentScreen({
  state,
  onStepPress,
  onDone,
}: {
  state: SellerOnboardingState;
  onStepPress?: (s: StepKey) => void;
  onDone: () => Promise<void> | void;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();

  const [number, setNumber] = useState('');
  const [stateCode, setStateCode] = useState(state.sellerStateCode ?? '');
  const [turnover, setTurnover] = useState<TurnoverBand | null>(null);
  const [address, setAddress] = useState('');
  const [decls, setDecls] = useState<Declarations>(NO_DECLARATIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitted = state.enrolmentSubmitted;

  // Restore the in-progress answers a seller left behind. Declarations are
  // deliberately NOT restored — a legal acceptance must be made deliberately,
  // in the session that submits it.
  useEffect(() => {
    if (submitted) return;
    let live = true;
    AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => {
        if (!live || !raw) return;
        const d = JSON.parse(raw) as { stateCode?: string; turnover?: TurnoverBand; address?: string };
        if (d.stateCode) setStateCode(d.stateCode);
        if (d.turnover) setTurnover(d.turnover);
        if (d.address) setAddress(d.address);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [submitted]);

  useEffect(() => {
    if (submitted) return;
    if (!stateCode && !turnover && !address) return;
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ stateCode, turnover, address })).catch(() => {});
  }, [stateCode, turnover, address, submitted]);

  const numberValid = ENROLMENT_RE.test(number);
  const numberError = number.length === 15 && !numberValid;
  const addressOk = address.trim().length >= 10;
  const allDeclared = ENROLMENT_DECLARATIONS.every((d) => decls[d.key]);
  const canSubmit = numberValid && !!stateCode && !!turnover && addressOk && allDeclared && !busy;

  async function submit() {
    if (!turnover) return;
    setError(null);
    setBusy(true);
    try {
      await submitEnrolment({
        enrolmentNumber: number,
        stateCode,
        turnoverBand: turnover,
        address: address.trim(),
        declarations: decls,
      });
      await AsyncStorage.removeItem(DRAFT_KEY).catch(() => {});
      await onDone();
    } catch (e) {
      const code = sellerErrorCode(e);
      setError(
        code === 'INVALID_ENROLMENT'
          ? 'The enrolment number must be exactly 15 letters or digits, as issued by the GST portal.'
          : code === 'INVALID_ADDRESS'
            ? 'Enter your principal pickup/business address (10–300 characters).'
            : code === 'INVALID_STATE'
              ? 'Please pick your operating State/UT.'
              : code === 'INVALID_TURNOVER'
                ? 'Please select your estimated annual turnover.'
                : code === 'DECLARATIONS_REQUIRED'
                  ? 'All declarations must be accepted to continue.'
                  : code === 'PAN_FIRST'
                    ? 'Verify your PAN before submitting your enrolment.'
                    : 'Could not submit. Check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  // ── Already submitted ───────────────────────────────────────────────────
  if (submitted) {
    return (
      <>
        <OnboardingStepHeader step="gst" onStepPress={onStepPress} />
        <ScrollView
          contentContainerStyle={[
            step5Styles.scroll,
            { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Step5Hero
            title="Enrolment"
            highlight="submitted"
            sub="Your details are queued for compliance review. You can finish the remaining steps now."
            art={require('../../assets/seller/enrolment.png')}
            artLabel="Enrolment document illustration"
          />
          <StatusPanel tone="warn" icon="time-outline" title="Pending manual review">
            <DetailRow label="Enrolment no." value={state.enrolmentMasked} />
            <DetailRow
              label="Operating State"
              value={stateName(state.enrolmentStateCode ?? state.sellerStateCode)}
            />
            <DetailRow label="Turnover" value={bandLabel(state.enrolmentTurnoverBand)} />
            <DetailRow label="Submitted on" value={formatWhen(state.enrolmentSubmittedAt)} />
            <DetailRow label="Declarations" value={state.declarationVersion} />
            <Text style={[styles.body, { color: c.textSecondary }]}>
              Enrolment numbers can’t be machine-verified, so our team checks them. Selling starts
              once the review passes.
            </Text>
          </StatusPanel>
          <PrimaryCta label="Continue" onPress={() => onDone()} />
        </ScrollView>
      </>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────
  return (
    <>
      <OnboardingStepHeader step="gst" onStepPress={onStepPress} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            step5Styles.scroll,
            { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Step5Hero
            title="Your enrolment"
            highlight="details"
            sub="Unregistered sellers need a GST portal enrolment number to sell through a marketplace, and may sell only within their declared State/UT."
            art={require('../../assets/seller/enrolment.png')}
            artLabel="Enrolment document illustration"
          />

          {/* A1 — how to obtain one. We can't enrol anyone; only the seller can. */}
          <Card>
            <View style={styles.helpHead}>
              <View style={[styles.helpIcon, { borderColor: 'rgba(74,143,229,0.45)' }]}>
                <Ionicons name="help" size={17} color={c.primary} />
              </View>
              <CardTitle>Don’t have one yet?</CardTitle>
            </View>
            {HOW_TO.map((t, i) => (
              <View key={t} style={styles.howRow}>
                <View style={[styles.howNum, { backgroundColor: c.primary }]}>
                  <Text style={styles.howNumText}>{i + 1}</Text>
                </View>
                <Text style={[styles.howText, { color: c.textSecondary }]}>{t}</Text>
              </View>
            ))}
            <GhostButton
              label="Open gst.gov.in"
              icon="open-outline"
              role="link"
              onPress={() => WebBrowser.openBrowserAsync(GST_PORTAL).catch(() => {})}
            />
            <Note>
              This enrolment is for eligible unregistered sellers supplying through e-commerce
              operators. It is different from regular GST registration.
            </Note>
            <Note icon="shield-outline">
              Eligibility and permitted selling scope depend on applicable GST rules and your
              declared State/UT. Complete the process on the GST portal itself — never enter your GST
              portal password or OTP inside Any&All.
            </Note>
          </Card>

          {/* A2–A5 — the seller's own details. */}
          <Card>
            <CardTitle>Enter your enrolment details</CardTitle>
            <Field
              label="Enrolment number"
              value={number}
              onChangeText={(t) => setNumber(normaliseTaxId(t))}
              maxLength={15}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Enter enrolment number"
              accessibilityLabel="GST portal enrolment number, 15 characters"
            />
            {numberError && (
              <Note tone="bad">
                Enrolment numbers are 15 letters or digits. Remove any spaces or symbols.
              </Note>
            )}

            <StatePicker
              label="Operating State / UT"
              hint="The State/UT associated with your unregistered seller enrolment and selling eligibility."
              value={stateCode}
              onChange={setStateCode}
            />

            <View style={{ gap: 7 }} accessibilityRole="radiogroup">
              <FieldLabel>Estimated annual turnover</FieldLabel>
              {TURNOVER_BANDS.map((t) => (
                <ChoiceRow
                  key={t.value}
                  label={t.label}
                  selected={turnover === t.value}
                  onPress={() => setTurnover(t.value)}
                />
              ))}
            </View>

            <Field
              label="Principal pickup / business address"
              value={address}
              onChangeText={setAddress}
              maxLength={300}
              multiline
              numberOfLines={3}
              placeholder="Enter full address"
              style={{ minHeight: 72, textAlignVertical: 'top' }}
              accessibilityLabel="Principal pickup or business address"
            />
          </Card>

          {/* A6 — the legally material part. Nothing is pre-ticked. */}
          <Card>
            <CardTitle>Your declarations</CardTitle>
            {ENROLMENT_DECLARATIONS.map((d) => (
              <CheckRow
                key={d.key}
                text={d.text}
                checked={decls[d.key]}
                onToggle={() => setDecls((p) => ({ ...p, [d.key]: !p[d.key] }))}
              />
            ))}
          </Card>

          {!!error && <Note tone="bad">{error}</Note>}

          <PrimaryCta
            label="Submit for review"
            onPress={submit}
            disabled={!canSubmit}
            busy={busy}
          />
          <Text style={[styles.footnote, { color: c.textFaint }]}>
            We record which declarations you accepted and when. Your enrolment is reviewed by our
            compliance team — it isn’t marked verified automatically.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17.5 },
  footnote: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16, textAlign: 'center' },

  helpHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  helpIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one },
  howNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  howNumText: { color: '#FFFFFF', fontSize: 11, fontFamily: Fonts.sansSemiBold },
  howText: { flex: 1, fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17.5 },
});
