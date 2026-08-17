// Step 5 — GSTIN verification, for sellers who chose "Regular GST registered"
// or "Composition taxpayer" at Tax Details.
//
// Both variants are this one screen: same shell, same components, different
// copy, artwork and confirmation rows. The only behavioural difference is
// which taxpayer type the backend must find.
//
// Verification is entirely server-side (POST /api/gst/verify → Cashfree
// Verification Suite). The backend confirms the registration is Active, that
// the PAN embedded in the GSTIN matches the seller's already-verified PAN,
// that the State agrees, and reads the real taxpayer type. Nothing here can
// self-declare past any of it: a valid-looking GSTIN is never "verified", and
// a provider outage returns manual_review rather than a false pass.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingStepHeader } from '@/components/onboarding-step-header';
import { StatePicker } from '@/components/state-picker';
import {
  Card,
  CardTitle,
  DetailRow,
  FieldLabel,
  GhostButton,
  Hint,
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
  GSTIN_RE,
  IN_STATES,
  normaliseTaxId,
  verifyGst,
  type GstVerifyResult,
  type SellerOnboardingState,
  type StepKey,
} from '@/lib/seller';

/** Server error code → what the seller should actually do about it. */
const ERROR_COPY: Record<string, string> = {
  INVALID_GSTIN: 'That GSTIN doesn’t look right. It’s 15 characters, e.g. 09ABCDE1234F1Z5.',
  GSTIN_NOT_FOUND: 'GSTN has no record of this GSTIN. Check the number and try again.',
  GSTIN_NOT_ACTIVE:
    'This GSTIN isn’t Active on the GST portal. Only an active registration can sell on Any&All.',
  PAN_MISMATCH:
    'Use a GSTIN associated with the PAN verified for this seller account.',
  STATE_MISMATCH: 'The State you picked doesn’t match the first two digits of this GSTIN.',
  PAN_FIRST: 'Verify your PAN first — we match your GSTIN against it.',
  TAX_STATUS_FIRST: 'Choose your tax registration type first.',
};

const stateName = (code?: string | null) =>
  IN_STATES.find((s) => s.code === code)?.name ?? null;

/** ISO → "07 Aug 2026, 5:42 pm". Returns null for anything unparseable so a
 *  bad timestamp omits the row instead of rendering "Invalid Date". */
function formatWhen(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d
    .toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(/ /g, ' ');
}

export function GstDetailsScreen({
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
  const composition = state.taxStatus === 'composition';

  const [gstin, setGstin] = useState('');
  // Manual pick is a fallback: once two digits of the GSTIN exist we derive
  // the State from it, because the GSTIN is the authoritative source.
  const [pickedState, setPickedState] = useState(state.sellerStateCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GstVerifyResult | null>(null);

  const derivedState = useMemo(() => {
    const prefix = gstin.slice(0, 2);
    return IN_STATES.some((s) => s.code === prefix) ? prefix : '';
  }, [gstin]);
  const effectiveState = derivedState || pickedState;
  // The seller picked a State, then typed a GSTIN registered somewhere else.
  // The backend rejects this too; catching it here saves a paid lookup.
  const stateConflict = !!derivedState && !!pickedState && derivedState !== pickedState;

  const formatValid = GSTIN_RE.test(gstin);
  const formatError = gstin.length === 15 && !formatValid;

  // Restored from a previous visit — the server already persisted the outcome.
  const savedStatus = state.gstVerificationStatus;
  const savedDone = ['verified', 'manual_review', 'mismatch'].includes(savedStatus ?? '');

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await verifyGst(gstin, effectiveState);
      if (res.status === 'rejected') {
        setError(
          (res.error && ERROR_COPY[res.error]) ||
            res.message ||
            'We couldn’t verify this GSTIN. Check the details and try again.'
        );
      } else {
        setResult(res);
      }
    } catch {
      // A network failure is not an invalid GSTIN, and must never read as one.
      setError('Couldn’t reach the verification service. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  // ── Outcome ─────────────────────────────────────────────────────────────
  if (result || savedDone) {
    const status = result?.status ?? savedStatus;
    const mismatch = status === 'mismatch';
    const manual = status === 'manual_review';

    const shownGstin = result?.maskedGstin ?? state.gstMasked ?? null;
    const taxpayerType = result?.taxpayerType ?? state.gstTaxpayerType ?? null;
    const verifiedAt = formatWhen(result ? undefined : state.gstVerifiedAt);

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
          {mismatch ? (
            <>
              <Step5Hero
                title="Registration-type"
                highlight="mismatch"
                sub={
                  composition
                    ? 'This GSTIN is registered as a regular taxpayer, not under the composition scheme.'
                    : 'This GSTIN is registered under the composition scheme, not as a regular taxpayer.'
                }
                art={
                  composition
                    ? require('../../assets/seller/gst-composition.png')
                    : require('../../assets/seller/gst-regular.png')
                }
                artLabel="GST registration illustration"
              />
              <StatusPanel tone="bad" icon="alert-circle-outline" title="Registration-type mismatch">
                <DetailRow label="GSTIN" value={shownGstin} />
                <DetailRow label="Registered as" value={taxpayerType} />
                <DetailRow
                  label="You selected"
                  value={composition ? 'Composition taxpayer' : 'Regular GST registered'}
                />
                <Text style={[styles.body, { color: c.textSecondary }]}>
                  We won’t verify you under the wrong registration type. Change your tax selection to
                  match this GSTIN, or enter a GSTIN that matches the type you chose.
                </Text>
              </StatusPanel>
              <GhostButton
                label="Change tax selection"
                icon="swap-horizontal-outline"
                onPress={() => onStepPress?.('tax')}
              />
            </>
          ) : (
            <>
              <Step5Hero
                title="Your GST"
                highlight="details"
                sub={
                  manual
                    ? 'Our compliance team is checking this registration. You can finish onboarding meanwhile.'
                    : 'Confirmed against the GST network. Check these are your business details, then continue.'
                }
                art={
                  composition
                    ? require('../../assets/seller/gst-composition.png')
                    : require('../../assets/seller/gst-regular.png')
                }
                artLabel="GST registration illustration"
              />

              <StatusPanel
                tone={manual ? 'warn' : 'ok'}
                icon={manual ? 'time-outline' : 'checkmark-circle-outline'}
                title={manual ? 'Queued for manual review' : 'Verified with the GST network'}
              >
                <DetailRow label="GSTIN" value={shownGstin} />
                <DetailRow
                  label="Registration"
                  value={result?.registrationStatus ?? state.gstRegistrationStatus ?? null}
                />
                <DetailRow label="Taxpayer type" value={taxpayerType} />
                <DetailRow
                  label="Legal name"
                  value={result?.legalName ?? state.gstLegalName ?? null}
                />
                <DetailRow
                  label="Trade name"
                  value={result?.tradeName ?? state.gstTradeName ?? null}
                />
                <DetailRow
                  label="State / UT"
                  value={stateName(result?.stateCode ?? state.gstStateCode ?? state.sellerStateCode)}
                />
                {!composition && (
                  <DetailRow
                    label="Principal place"
                    value={result?.principalPlace ?? state.gstPrincipalPlace ?? null}
                  />
                )}
                <DetailRow label="Verified on" value={verifiedAt} />
              </StatusPanel>

              {manual && (
                <Note tone="warn" icon="time-outline">
                  This happens when the GST network doesn’t return a registration type, or the
                  provider is unreachable. Nothing is marked verified until a reviewer confirms it.
                </Note>
              )}
              {result?.reused && (
                <Note icon="refresh-outline">
                  Showing your existing verification — we didn’t run this check again.
                </Note>
              )}
              {composition && (
                <Note>
                  Composition accounts are restricted to intra-State orders on Any&All. Delivery
                  eligibility is enforced on every order from your verified State/UT.
                </Note>
              )}

              <PrimaryCta label="Continue" onPress={() => onDone()} />
            </>
          )}
        </ScrollView>
      </>
    );
  }

  // ── Entry form ──────────────────────────────────────────────────────────
  const canSubmit = formatValid && !!effectiveState && !stateConflict && !busy;

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
            title="Your GST"
            highlight="details"
            sub={
              composition
                ? 'We’ll verify your GSTIN and confirm your registration is active under the composition scheme.'
                : 'Add your GSTIN so we can verify your registration and business details.'
            }
            art={
              composition
                ? require('../../assets/seller/gst-composition.png')
                : require('../../assets/seller/gst-regular.png')
            }
            artLabel="GST registration illustration"
          />

          <Card>
            <Field
              label="GSTIN"
              value={gstin}
              onChangeText={(t) => setGstin(normaliseTaxId(t))}
              maxLength={15}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Enter GSTIN"
              accessibilityLabel="GSTIN, 15 characters"
            />
            <Hint>15-character GSTIN, e.g. 09ABCDE1234F1Z5.</Hint>
            {formatError && (
              <Note tone="bad">
                That isn’t a valid GSTIN structure. Check each character — it’s 2 State digits, your
                10-character PAN, then 3 more.
              </Note>
            )}

            {/* State is authoritative from the GSTIN itself; the picker is only
                for sellers who haven't typed one yet. */}
            {derivedState ? (
              <View style={{ gap: 6 }}>
                <FieldLabel>State / UT of registration</FieldLabel>
                <View style={[styles.derived, { borderColor: c.border, backgroundColor: c.background }]}>
                  <Ionicons name="location-outline" size={16} color={c.primary} />
                  <Text style={[styles.derivedText, { color: c.text }]}>
                    {stateName(derivedState)}
                  </Text>
                  <Text style={[styles.derivedTag, { color: c.textFaint }]}>from GSTIN</Text>
                </View>
              </View>
            ) : (
              <StatePicker
                label="State / UT of registration"
                hint="Must match the first two digits of your GSTIN."
                value={pickedState}
                onChange={setPickedState}
              />
            )}
            {stateConflict && (
              <Note tone="bad">
                This GSTIN is registered in {stateName(derivedState)}, but you selected{' '}
                {stateName(pickedState)}. We’ll use the GSTIN’s State — clear the GSTIN if that’s
                wrong.
              </Note>
            )}

            {/* Authoritative business identity comes from the register, not
                from the seller typing it. Shown read-only until verified. */}
            <View style={{ gap: 6 }}>
              <FieldLabel>Business / legal name (as per GST)</FieldLabel>
              <View style={[styles.readonly, { borderColor: c.border, backgroundColor: c.background }]}>
                <Text style={[styles.readonlyText, { color: c.textFaint }]}>
                  Auto-filled after GSTIN verification
                </Text>
              </View>
            </View>
          </Card>

          {/* Registration type is decided at Tax Details — shown here as a
              confirmation with a way back, never as a second source of truth. */}
          <Card>
            <View style={styles.typeHead}>
              <View style={{ flex: 1, gap: 2 }}>
                <CardTitle>GST registration type</CardTitle>
                <Text style={[styles.body, { color: c.textSecondary }]}>
                  {composition ? 'Composition taxpayer' : 'Regular taxpayer'}
                </Text>
              </View>
              <Ionicons name="shield-checkmark-outline" size={20} color={c.primary} />
            </View>
            <Text style={[styles.small, { color: c.textFaint }]}>
              We verify your GSTIN is registered under this type. If it isn’t, you can change your
              selection — we won’t verify you under the wrong one.
            </Text>
            <GhostButton
              label="Change tax selection"
              icon="swap-horizontal-outline"
              onPress={() => onStepPress?.('tax')}
            />
          </Card>

          {!!error && <Note tone="bad">{error}</Note>}

          <PrimaryCta
            label="Verify GSTIN"
            icon="shield-checkmark-outline"
            onPress={submit}
            disabled={!canSubmit}
            busy={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17.5 },
  small: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16 },

  typeHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  derived: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    minHeight: 48,
  },
  derivedText: { flex: 1, fontSize: 14, fontFamily: Fonts.sansMedium },
  derivedTag: { fontSize: 11, fontFamily: Fonts.sans },

  readonly: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    justifyContent: 'center',
    minHeight: 48,
  },
  readonlyText: { fontSize: 13.5, fontFamily: Fonts.sans },
});
