// Step 6 — bank account for seller payouts.
//
// Verification is server-side (POST /api/bank/verify → Sandbox.co.in). That
// provider performs a REAL ₹1 penny drop and returns the name the bank holds
// for the account, which the backend matches against the seller's
// Aadhaar-verified name. So the "we'll deposit ₹1" wording on this screen is
// literally true — money genuinely moves — and must not be softened.
//
// Money is at stake on every attempt, so the backend blocks re-verification
// of an already-verified account and caps lifetime attempts (kycQuota.js).
// This screen adds the first line of that defence: the CTA is disabled while
// a request is in flight, and every terminal state replaces the form rather
// than inviting another tap.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingStepHeader } from '@/components/onboarding-step-header';
import {
  Card,
  CardTitle,
  DetailRow,
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
  ACCOUNT_RE,
  IFSC_RE,
  verifyBank,
  type BankVerifyResult,
  type SellerOnboardingState,
  type StepKey,
} from '@/lib/seller';

/** Server error code → what the seller should actually do about it. */
const ERROR_COPY: Record<string, string> = {
  INVALID_ACCOUNT: 'Account number must be 9–18 digits.',
  INVALID_IFSC: 'Check the IFSC code and try again. It’s 11 characters, e.g. HDFC0001234.',
  ACCOUNT_NOT_FOUND:
    'We couldn’t verify this bank account. Check the account number and IFSC — they must belong to the same account.',
  AADHAAR_FIRST: 'Verify your identity via DigiLocker before adding a bank account.',
  ALREADY_VERIFIED:
    'A bank account is already verified on this seller account. Contact support to change it.',
  KYC_ATTEMPTS_EXCEEDED:
    'Too many verification attempts on this account. Please contact support.',
  IDENTITY_ALREADY_USED: 'This bank account is already linked to another seller account.',
  PROVIDER_UNAVAILABLE:
    'Bank verification is temporarily unavailable. No money was moved — please try again shortly.',
};

const FORMAT_RULES = ['9–18 digits', 'Numbers only', 'No spaces'];

/** "XXXXXX1234" → "••••1234". Never reconstructs the full number. */
function bulletMask(masked?: string | null): string | null {
  if (!masked) return null;
  const last4 = masked.slice(-4);
  return /^\d{4}$/.test(last4) ? `••••${last4}` : masked;
}

/** IFSC is a branch identifier, not a secret, but it's masked in the success
 *  panel so a screenshot of payout details gives away less. */
function maskIfsc(ifsc?: string | null): string | null {
  if (!ifsc || ifsc.length !== 11) return ifsc ?? null;
  return `${ifsc.slice(0, 4)}••••${ifsc.slice(-3)}`;
}

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

export function BankDetailsScreen({
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

  const [account, setAccount] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BankVerifyResult | null>(null);
  const [showWhy, setShowWhy] = useState(false);

  const accountValid = ACCOUNT_RE.test(account);
  const accountError = account.length > 0 && account.length >= 9 && !accountValid;
  const confirmMismatch = confirm.length > 0 && confirm !== account;
  const ifscValid = IFSC_RE.test(ifsc);
  const ifscError = ifsc.length === 11 && !ifscValid;

  const canSubmit = accountValid && confirm === account && ifscValid && !busy;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await verifyBank(account, ifsc);
      if (res.verified || res.status === 'name_mismatch' || res.status === 'manual_review') {
        setResult(res);
      } else {
        setError(
          (res.error && ERROR_COPY[res.error]) ||
            res.message ||
            'We couldn’t verify this bank account. Check the details and try again.'
        );
      }
    } catch (e) {
      // The client library throws for non-2xx. Pull the code out so a provider
      // outage or an attempt cap reads correctly instead of "bad details".
      const code =
        typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
      setError(
        ERROR_COPY[code] ||
          'Couldn’t reach the verification service. Check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  // ── Verified ────────────────────────────────────────────────────────────
  // `state.bankVerified` is the server's word, restored on every load, so this
  // survives an app restart without another penny drop.
  if (result?.verified || state.bankVerified) {
    const shownAccount = bulletMask(result?.maskedAccount ?? state.bankMasked);
    const shownIfsc = result?.maskedIfsc ?? maskIfsc(state.bankIfsc ?? result?.ifsc ?? null);

    return (
      <>
        <OnboardingStepHeader step="bank" onStepPress={onStepPress} />
        <ScrollView
          contentContainerStyle={[
            step5Styles.scroll,
            { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Step5Hero
            title="Bank account"
            highlight="verified"
            sub="Your seller payouts will be sent to this account."
            art={require('../../assets/seller/bank.png')}
            artLabel="Bank account illustration"
          />
          <StatusPanel tone="ok" icon="checkmark-circle-outline" title="Bank account verified">
            <DetailRow label="Account" value={shownAccount} />
            <DetailRow label="IFSC" value={shownIfsc} />
            <DetailRow label="Holder match" value="Confirmed" />
            <DetailRow label="Verified on" value={formatWhen(state.bankVerifiedAt)} />
          </StatusPanel>
          <Note icon="lock-closed-outline">
            To change your payout account later, contact support — verified payout details can’t be
            edited in the app.
          </Note>
          <PrimaryCta label="Continue" onPress={() => onDone()} />
        </ScrollView>
      </>
    );
  }

  // ── Name mismatch / manual review ───────────────────────────────────────
  if (result && (result.status === 'name_mismatch' || result.status === 'manual_review')) {
    const mismatch = result.status === 'name_mismatch';
    return (
      <>
        <OnboardingStepHeader step="bank" onStepPress={onStepPress} />
        <ScrollView
          contentContainerStyle={[
            step5Styles.scroll,
            { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Step5Hero
            title={mismatch ? 'Name' : 'Additional'}
            highlight={mismatch ? 'mismatch' : 'review'}
            sub={
              mismatch
                ? 'The bank holds a different name for this account than the identity you verified.'
                : 'Your bank didn’t return an account-holder name, so we can’t confirm the match automatically.'
            }
            art={require('../../assets/seller/bank.png')}
            artLabel="Bank account illustration"
          />
          <StatusPanel
            tone={mismatch ? 'bad' : 'warn'}
            icon={mismatch ? 'alert-circle-outline' : 'time-outline'}
            title={
              mismatch
                ? 'Account-holder name doesn’t match your verified identity'
                : 'Your bank account needs additional review'
            }
          >
            {mismatch && <DetailRow label="Bank holds" value={result.bankNameHint} />}
            <Text style={[styles.body, { color: c.textSecondary }]}>
              {mismatch
                ? 'Use a bank account belonging to the same verified seller. Joint accounts must list you as the primary holder.'
                : 'Our team will check this manually. You can also try a different account.'}
            </Text>
          </StatusPanel>
          <PrimaryCta
            label="Try another account"
            icon="refresh-outline"
            onPress={() => {
              setResult(null);
              setAccount('');
              setConfirm('');
              setIfsc('');
            }}
          />
        </ScrollView>
      </>
    );
  }

  // ── Entry form ──────────────────────────────────────────────────────────
  return (
    <>
      <OnboardingStepHeader step="bank" onStepPress={onStepPress} />
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
            title="Add your"
            highlight="bank"
            trailing="account"
            sub="We’ll deposit ₹1 to confirm the account is yours. The account-holder name must match your verified details."
            art={require('../../assets/seller/bank.png')}
            artLabel="Bank account illustration"
          />

          <Card>
            <Field
              label="Account number"
              value={account}
              onChangeText={(t) => setAccount(t.replace(/\D/g, '').slice(0, 18))}
              keyboardType="number-pad"
              autoCorrect={false}
              maxLength={18}
              placeholder="Enter 9–18 digit account number"
              accessibilityLabel="Bank account number, 9 to 18 digits"
            />
            <View style={styles.rules}>
              {FORMAT_RULES.map((r, i) => (
                <View key={r} style={styles.ruleItem}>
                  {i > 0 && <View style={[styles.ruleDivider, { backgroundColor: c.border }]} />}
                  <Ionicons name="checkmark-circle-outline" size={13} color={c.primary} />
                  <Text style={[styles.ruleText, { color: c.textSecondary }]}>{r}</Text>
                </View>
              ))}
            </View>
            {accountError && <Note tone="bad">Account number must be 9–18 digits.</Note>}

            <Field
              label="Confirm account number"
              value={confirm}
              onChangeText={(t) => setConfirm(t.replace(/\D/g, '').slice(0, 18))}
              keyboardType="number-pad"
              autoCorrect={false}
              maxLength={18}
              // Paste is left enabled deliberately: this app has no anti-paste
              // standard, and blocking it pushes people to mistype instead.
              placeholder="Re-enter account number"
              accessibilityLabel="Confirm bank account number"
            />
            {confirmMismatch && <Note tone="bad">Account numbers do not match</Note>}

            <Field
              label="IFSC code"
              value={ifsc}
              onChangeText={(t) => setIfsc(t.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 11))}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={11}
              placeholder="Enter 11-character IFSC"
              accessibilityLabel="IFSC code, 11 characters"
            />
            {/* No "Find IFSC" action: this project has no IFSC lookup service,
                and inventing branch data would be worse than omitting it. */}
            <Hint>Example: HDFC0001234 — it’s on your cheque book and passbook.</Hint>
            {ifscError && (
              <Note tone="bad">
                Check the IFSC code and try again. It’s 4 letters, a zero, then 6 more characters.
              </Note>
            )}
          </Card>

          <Note icon="shield-checkmark-outline">
            We use this account only for seller payouts and verification. The full number is
            encrypted before storage and never shown again.
          </Note>

          {!!error && <Note tone="bad">{error}</Note>}

          <PrimaryCta
            label="Verify bank account"
            icon="shield-checkmark-outline"
            onPress={submit}
            disabled={!canSubmit}
            busy={busy}
          />
          {busy && (
            <Text
              style={[styles.busyNote, { color: c.textFaint }]}
              accessibilityLiveRegion="polite"
            >
              Verifying bank account… this can take a few seconds.
            </Text>
          )}

          {/* Kept off the main screen so the form stays short. */}
          <Pressable
            onPress={() => setShowWhy((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showWhy }}
            accessibilityLabel="Why we need this"
            style={styles.whyRow}
          >
            <Text style={[styles.whyText, { color: c.primary }]}>Why we need this</Text>
            <Ionicons name={showWhy ? 'chevron-up' : 'chevron-forward'} size={16} color={c.primary} />
          </Pressable>
          {showWhy && (
            <Card>
              <CardTitle>Why we need your bank account</CardTitle>
              <Text style={[styles.body, { color: c.textSecondary }]}>
                Your sales payouts are sent to this account. We deposit ₹1 to confirm the account is
                real and active, and we check the name your bank holds against the identity you
                verified — that’s what stops someone routing payouts to an account that isn’t
                theirs. Bank details can be changed later through support.
              </Text>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17.5 },
  busyNote: { fontSize: 11.5, fontFamily: Fonts.sans, textAlign: 'center' },

  rules: { flexDirection: 'row', alignItems: 'center' },
  ruleItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  ruleDivider: { width: StyleSheet.hairlineWidth, height: 18, marginRight: Spacing.one },
  ruleText: { fontSize: 11, fontFamily: Fonts.sans },

  whyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 },
  whyText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
});
