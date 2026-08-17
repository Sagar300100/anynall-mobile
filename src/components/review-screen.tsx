// Step 8 — final review and submission.
//
// Every row here is derived from the onboarding state the backend returned;
// nothing is assumed complete. The Submit button only gates the UI — the real
// decision is POST /seller-onboarding/complete, which revalidates all eight
// steps server-side and refuses anything stale, so a seller can't submit past
// this screen by fiddling with local state.
//
// Submission is idempotent server-side: an application already submitted is
// returned as-is rather than duplicated with a fresh timestamp and id.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingStepHeader } from '@/components/onboarding-step-header';
import {
  Card,
  CardTitle,
  DetailRow,
  Note,
  PrimaryCta,
  StatusPanel,
  Step5Hero,
  TAB_BAR_CLEARANCE,
  TONE,
  step5Styles,
} from '@/components/step5-parts';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  completeSellerOnboarding,
  IN_STATES,
  sellerErrorCode,
  type SellerOnboardingState,
  type StepKey,
} from '@/lib/seller';

const TAX_LABEL: Record<string, string> = {
  regular_gst: 'Regular GST registered',
  composition: 'Composition taxpayer',
  unregistered_enrolled: 'Not GST registered',
};

/** `ok` = verified. `review` = real but awaiting a human. `todo` = not done.
 *  `stale` = was done, but something it depended on changed. */
type RowState = 'ok' | 'review' | 'todo' | 'stale';

interface Row {
  key: string;
  step: StepKey;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
  state: RowState;
}

const stateMeta: Record<RowState, { tone: string; icon: keyof typeof Ionicons.glyphMap; action: string }> = {
  ok: { tone: TONE.ok, icon: 'checkmark-circle', action: 'Edit' },
  review: { tone: TONE.warn, icon: 'time', action: 'View' },
  todo: { tone: TONE.warn, icon: 'ellipse-outline', action: 'Complete' },
  stale: { tone: TONE.bad, icon: 'alert-circle', action: 'Fix' },
};

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

function formatVersion(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

const stateName = (code?: string | null) => IN_STATES.find((s) => s.code === code)?.name ?? null;

/** Build the summary straight from server state — never from local flags. */
function buildRows(s: SellerOnboardingState): Row[] {
  const rows: Row[] = [];

  rows.push({
    key: 'store',
    step: 'store',
    icon: 'storefront-outline',
    title: 'Store information',
    value: s.storeSetupComplete
      ? `${s.storeName}${s.storeHandle ? ` (@${s.storeHandle})` : ''}`
      : 'Not set up yet',
    state: s.storeSetupComplete ? 'ok' : 'todo',
  });

  rows.push({
    key: 'tax',
    step: 'tax',
    icon: 'document-text-outline',
    title: 'Tax status',
    value: (s.taxStatus && TAX_LABEL[s.taxStatus]) || 'Not selected',
    state: s.taxStatus ? 'ok' : 'todo',
  });

  rows.push({
    key: 'aadhaar',
    step: 'aadhaar',
    icon: 'person-circle-outline',
    title: 'Identity',
    value: s.aadhaarVerified
      ? `Aadhaar verified via ${s.aadhaarVerifiedVia === 'digilocker' || !s.aadhaarVerifiedVia ? 'DigiLocker' : s.aadhaarVerifiedVia}`
      : 'Not verified',
    state: s.aadhaarVerified ? 'ok' : 'todo',
  });

  rows.push({
    key: 'pan',
    step: 'pan',
    icon: 'card-outline',
    title: 'PAN',
    // Masked only — the full PAN never leaves the backend.
    value: s.panVerified ? (s.panMasked ? `Verified · ${s.panMasked}` : 'Verified') : 'Not verified',
    state: s.panVerified ? 'ok' : 'todo',
  });

  // Step 5 is a different thing entirely depending on the tax path, so the
  // row is built per path rather than shoehorned into one label.
  if (s.taxStatus === 'unregistered_enrolled') {
    const declared = stateName(s.enrolmentStateCode ?? s.sellerStateCode);
    rows.push({
      key: 'gst',
      step: 'gst',
      icon: 'receipt-outline',
      title: 'Enrolment details',
      value: s.enrolmentSubmitted
        ? `Submitted for review${declared ? ` · ${declared}` : ''}`
        : 'Not submitted',
      // Never called "GST verified" — no API verifies these.
      state: s.enrolmentSubmitted ? 'review' : 'todo',
    });
  } else {
    const gs = s.gstVerificationStatus;
    const type = s.taxStatus === 'composition' ? 'Composition' : 'Regular taxpayer';
    rows.push({
      key: 'gst',
      step: 'gst',
      icon: 'receipt-outline',
      title: 'GST details',
      value:
        gs === 'verified'
          ? `Verified · ${type}${s.gstMasked ? ` · ${s.gstMasked}` : ''}`
          : gs === 'manual_review'
            ? 'Submitted for review'
            : gs === 'mismatch'
              ? 'Registration type doesn’t match your tax selection'
              : gs === 'rejected'
                ? 'Could not be verified'
                : 'Not verified',
      state:
        gs === 'verified'
          ? 'ok'
          : gs === 'manual_review'
            ? 'review'
            : gs === 'mismatch' || gs === 'rejected'
              ? 'stale'
              : 'todo',
    });
  }

  rows.push({
    key: 'bank',
    step: 'bank',
    icon: 'business-outline',
    title: 'Bank account',
    value: s.bankVerified
      ? `Verified${s.bankMasked ? ` · ••••${s.bankMasked.slice(-4)}` : ''}`
      : 'Not verified',
    state: s.bankVerified ? 'ok' : 'todo',
  });

  // Consent must be against the version in force now. An older acceptance is
  // stale and the backend refuses the submission too.
  const current = s.sellerTermsVersion ?? null;
  const accepted = s.sellerTermsAcceptedVersion ?? null;
  const termsStale = s.sellerTermsAccepted && !!current && !!accepted && accepted !== current;
  const when = formatWhen(s.sellerTermsAcceptedAt);
  rows.push({
    key: 'agreement',
    step: 'agreement',
    icon: 'shield-checkmark-outline',
    title: 'Seller agreement',
    value: termsStale
      ? 'Terms updated — please review and accept again'
      : s.sellerTermsAccepted
        ? `Accepted${when ? ` on ${when}` : ''}${accepted ? `\nVersion: ${formatVersion(accepted)}` : ''}`
        : 'Not accepted',
    state: termsStale ? 'stale' : s.sellerTermsAccepted ? 'ok' : 'todo',
  });

  return rows;
}

export function ReviewScreen({
  state,
  onStepPress,
  onSubmitted,
  onDone,
}: {
  state: SellerOnboardingState;
  onStepPress?: (s: StepKey) => void;
  /** Refreshes onboarding state after a successful submission. */
  onSubmitted?: () => Promise<void> | void;
  /** Leave the flow — used by "Return to Seller Hub". */
  onDone: () => Promise<void> | void;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    applicationStatus: string;
    applicationId?: string | null;
  } | null>(null);

  const rows = buildRows(state);
  const blocking = rows.filter((r) => r.state === 'todo' || r.state === 'stale');
  const reviewing = rows.filter((r) => r.state === 'review');
  const ready = blocking.length === 0;

  // Already submitted on a previous visit, or just now.
  const submittedStatus =
    result?.applicationStatus ??
    (['pending_review', 'approved', 'action_required'].includes(state.applicationStatus)
      ? state.applicationStatus
      : null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await completeSellerOnboarding();
      setResult({ applicationStatus: res.applicationStatus, applicationId: res.applicationId });
      await onSubmitted?.();
    } catch (e) {
      const code = sellerErrorCode(e);
      setError(
        code === 'AGREEMENT_OUTDATED'
          ? 'The Seller Terms have been updated. Review and accept the current version, then submit again.'
          : code === 'GST_TYPE_MISMATCH'
            ? 'Your GSTIN’s registration type doesn’t match your tax selection. Fix that step, then submit again.'
            : 'We couldn’t submit your application. Your progress is saved — please try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  // ── Post-submission ─────────────────────────────────────────────────────
  if (submittedStatus) {
    const approved = submittedStatus === 'approved';
    const needsAction = submittedStatus === 'action_required';
    return (
      <>
        <OnboardingStepHeader step="review" onStepPress={onStepPress} />
        <ScrollView
          contentContainerStyle={[
            step5Styles.scroll,
            { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Step5Hero
            title={approved ? 'You’re ready to' : needsAction ? 'Action' : 'Application'}
            highlight={approved ? 'sell' : needsAction ? 'required' : 'submitted'}
            sub={
              approved
                ? 'Your seller account is approved.'
                : needsAction
                  ? 'Some details need correcting before we can approve your account.'
                  : 'We’re reviewing your seller information.'
            }
            art={require('../../assets/seller/review.png')}
            artLabel="Application review illustration"
          />
          <StatusPanel
            tone={approved ? 'ok' : needsAction ? 'bad' : 'warn'}
            icon={approved ? 'checkmark-circle-outline' : needsAction ? 'alert-circle-outline' : 'time-outline'}
            title={
              approved ? 'Approved' : needsAction ? 'Changes required' : 'Application under review'
            }
          >
            <DetailRow
              label="Application ID"
              value={result?.applicationId ?? state.sellerApplicationId ?? null}
            />
            <DetailRow label="Submitted on" value={formatWhen(state.submittedAt)} />
            {!approved && !needsAction && (
              // No invented SLA — we don't publish one, so we don't claim one.
              <Text style={[styles.body, { color: c.textSecondary }]}>
                We’ll notify you once the review is complete. You don’t need to do anything else for
                now.
              </Text>
            )}
          </StatusPanel>
          {needsAction && (
            <Note tone="bad">
              Open the highlighted steps from the tracker above to correct them, then submit again.
            </Note>
          )}
          <PrimaryCta
            label={approved ? 'Go to Seller Hub' : 'Return to Seller Hub'}
            onPress={() => onDone()}
          />
        </ScrollView>
      </>
    );
  }

  // ── Review + submit ─────────────────────────────────────────────────────
  return (
    <>
      <OnboardingStepHeader step="review" onStepPress={onStepPress} />
      <ScrollView
        contentContainerStyle={[
          step5Styles.scroll,
          { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Step5Hero
          title="Review your"
          highlight="application"
          sub="Check everything before submitting. You can edit any step if needed."
          art={require('../../assets/seller/review.png')}
          artLabel="Application review illustration"
        />

        <Card>
          <CardTitle>Your onboarding summary</CardTitle>
          {rows.map((r, i) => {
            const meta = stateMeta[r.state];
            return (
              <View key={r.key}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                <Pressable
                  onPress={onStepPress ? () => onStepPress(r.step) : undefined}
                  disabled={!onStepPress}
                  accessibilityRole="button"
                  // State is announced, never signalled by colour alone.
                  accessibilityLabel={`${r.title}. ${r.value.replace(/\n/g, '. ')}. ${meta.action}`}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={[styles.rowIcon, { backgroundColor: 'rgba(46,107,255,0.14)' }]}>
                    <Ionicons name={r.icon} size={17} color={c.primary} />
                  </View>
                  <Ionicons name={meta.icon} size={17} color={meta.tone} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.rowTitle, { color: c.text }]}>{r.title}</Text>
                    <Text style={[styles.rowValue, { color: c.textSecondary }]}>{r.value}</Text>
                  </View>
                  <Text style={[styles.action, { color: c.primary }]}>{meta.action}</Text>
                  <Ionicons name="chevron-forward" size={15} color={c.primary} />
                </Pressable>
              </View>
            );
          })}
        </Card>

        {/* Honest readiness — never "all good" while anything is outstanding. */}
        {ready ? (
          <StatusPanel
            tone={reviewing.length ? 'warn' : 'ok'}
            icon={reviewing.length ? 'time-outline' : 'shield-checkmark-outline'}
            title={reviewing.length ? 'Some details need review' : 'All details look good!'}
          >
            <Text style={[styles.body, { color: c.textSecondary }]}>
              {reviewing.length
                ? 'You can submit now — our team will check the items marked for review.'
                : 'You can go back and edit any step before submitting.'}
            </Text>
          </StatusPanel>
        ) : (
          <StatusPanel tone="warn" icon="alert-circle-outline" title="Finish the remaining steps">
            <Text style={[styles.body, { color: c.textSecondary }]}>
              Complete the highlighted items before submitting your seller application:
            </Text>
            {blocking.map((b) => (
              <Text key={b.key} style={[styles.body, { color: c.text }]}>
                • {b.title}
              </Text>
            ))}
          </StatusPanel>
        )}

        {!!error && <Note tone="bad">{error}</Note>}

        <PrimaryCta
          label="Submit application"
          onPress={submit}
          disabled={!ready}
          busy={busy}
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17.5 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 48 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  rowValue: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16 },
  action: { fontSize: 13, fontFamily: Fonts.sansMedium },
});
