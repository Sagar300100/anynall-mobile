// Step 7 — Seller Agreement.
//
// Legal acceptance is recorded server-side and VERSIONED. The backend is the
// only authority on which version is current: this screen renders whatever
// `sellerTermsVersion` the onboarding GET returns, sends that same version
// back on accept, and the backend rejects it with TERMS_VERSION_CHANGED if the
// terms moved on meanwhile — so consent is never recorded against text the
// seller didn't actually see.
//
// Re-tapping Accept is idempotent server-side: an existing acceptance of the
// current version is returned unchanged rather than overwritten, so the legal
// timestamp can't drift. Accepting a NEW version adds a consent record instead
// of replacing the old one.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingStepHeader } from '@/components/onboarding-step-header';
import {
  Card,
  CardTitle,
  CheckRow,
  DetailRow,
  Note,
  PrimaryCta,
  StatusPanel,
  Step5Hero,
  TAB_BAR_CLEARANCE,
  step5Styles,
} from '@/components/step5-parts';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  acceptSellerAgreement,
  SELLER_TERMS_URL,
  sellerErrorCode,
  TAX_ACKNOWLEDGEMENT,
  type SellerOnboardingState,
  type StepKey,
} from '@/lib/seller';

/** A summary of the obligations, not the agreement itself — the full text
 *  lives at the Seller Terms link and is what checkbox 1 actually covers. */
const OBLIGATIONS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'cash-outline',
    title: 'Payouts',
    body: 'Payouts are released according to the applicable payout policy after eligible order completion.',
  },
  {
    icon: 'cube-outline',
    title: 'Shipping & fulfilment',
    body: 'Ship orders on time, provide valid tracking where required, and follow Any&All fulfilment rules.',
  },
  {
    icon: 'return-down-back-outline',
    title: 'Refunds, returns & disputes',
    body: 'Orders are subject to Any&All’s applicable buyer-protection, refund, return and dispute rules.',
  },
  {
    icon: 'videocam-outline',
    title: 'Livestream & listing accuracy',
    body: 'Product descriptions, demonstrations, claims, prices and statements made during live selling must be accurate and not misleading.',
  },
  {
    icon: 'ban-outline',
    title: 'Prohibited & counterfeit products',
    body: 'You may not list or sell prohibited, illegal, counterfeit or otherwise restricted products.',
  },
  {
    icon: 'warning-outline',
    title: 'Suspension & termination',
    body: 'Policy violations, fraud, unsafe activity or legal/compliance issues may result in selling restrictions, suspension or account termination.',
  },
];

/** "2026-07-04" → "04 July 2026". Falls back to the raw value so an
 *  unexpected format still shows something truthful. */
function formatVersion(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
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

export function AgreementScreen({
  state,
  onStepPress,
  onDone,
  onRefresh,
}: {
  state: SellerOnboardingState;
  onStepPress?: (s: StepKey) => void;
  onDone: () => Promise<void> | void;
  /** Re-reads onboarding state — used to pick up a new terms version. */
  onRefresh?: () => Promise<void>;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();

  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedTax, setAgreedTax] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentVersion = state.sellerTermsVersion ?? null;
  const acceptedVersion = state.sellerTermsAcceptedVersion ?? null;
  // Accepted, and against the version that is still current.
  const upToDate = state.sellerTermsAccepted && !!currentVersion && acceptedVersion === currentVersion;
  // Accepted an older version — consent is stale and must be taken again.
  const supersededByNewTerms =
    state.sellerTermsAccepted && !!acceptedVersion && !!currentVersion && acceptedVersion !== currentVersion;

  const taxStatus = state.taxStatus;
  const taxText = taxStatus ? TAX_ACKNOWLEDGEMENT[taxStatus] : null;

  // Without an authoritative version there is nothing valid to consent to.
  const versionMissing = !currentVersion;
  const canAccept = agreedTerms && (!taxText || agreedTax) && !versionMissing && !busy;

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      await acceptSellerAgreement(currentVersion ?? undefined);
      await onDone();
    } catch (e) {
      const code = sellerErrorCode(e);
      if (code === 'TERMS_VERSION_CHANGED') {
        // Pull the new version in and make them read it — do not accept
        // against the text that was on screen a moment ago.
        setAgreedTerms(false);
        setAgreedTax(false);
        await onRefresh?.();
        setError(
          'The Seller Terms were updated while this page was open. Please review the current version and agree again.'
        );
      } else {
        setError(
          code === 'TAX_STATUS_FIRST'
            ? 'Complete your tax details before accepting the agreement.'
            : 'We couldn’t save your agreement. Please try again.'
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function openTerms() {
    // Opening the terms is explicitly NOT acceptance — the checkboxes are
    // untouched here, and they stay wherever the seller left them.
    WebBrowser.openBrowserAsync(SELLER_TERMS_URL).catch(() => {});
  }

  // ── Already accepted the current version ────────────────────────────────
  if (upToDate) {
    return (
      <>
        <OnboardingStepHeader step="agreement" onStepPress={onStepPress} />
        <ScrollView
          contentContainerStyle={[
            step5Styles.scroll,
            { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Step5Hero
            title="Seller Agreement"
            highlight="accepted"
            sub="You’ve accepted the current Seller Terms. You can review them any time."
            art={require('../../assets/seller/agreement.png')}
            artLabel="Seller agreement illustration"
          />
          <StatusPanel tone="ok" icon="checkmark-circle-outline" title="Agreement accepted">
            <DetailRow label="Version" value={formatVersion(acceptedVersion)} />
            <DetailRow label="Accepted on" value={formatWhen(state.sellerTermsAcceptedAt)} />
          </StatusPanel>
          <TermsLink onPress={openTerms} version={formatVersion(currentVersion)} />
          <PrimaryCta label="Continue" onPress={() => onDone()} />
        </ScrollView>
      </>
    );
  }

  // ── Accept / re-accept ──────────────────────────────────────────────────
  return (
    <>
      <OnboardingStepHeader step="agreement" onStepPress={onStepPress} />
      <ScrollView
        contentContainerStyle={[
          step5Styles.scroll,
          { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Step5Hero
          title="Review and accept the Seller"
          highlight="Agreement"
          sub="Before selling on Any&All, review the key obligations that apply to your seller account."
          art={require('../../assets/seller/agreement.png')}
          artLabel="Seller agreement illustration"
        />

        {supersededByNewTerms && (
          <Note tone="warn" icon="refresh-outline">
            The Seller Terms have been updated since you last accepted them (you agreed to{' '}
            {formatVersion(acceptedVersion)}). Please review the current version and agree again.
          </Note>
        )}
        {versionMissing && (
          <Note tone="bad">
            We couldn’t load the current Seller Terms. You can’t accept until we know which version
            applies — please check your connection and reopen this step.
          </Note>
        )}

        <Card>
          <View style={styles.cardHead}>
            <View style={[styles.cardIcon, { borderColor: 'rgba(74,143,229,0.45)' }]}>
              <Ionicons name="document-text-outline" size={17} color={c.primary} />
            </View>
            <CardTitle>Key things to know</CardTitle>
          </View>

          {OBLIGATIONS.map((o, i) => (
            <View key={o.title}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
              <View style={styles.row} accessible accessibilityLabel={`${o.title}. ${o.body}`}>
                <View style={[styles.rowIcon, { backgroundColor: 'rgba(46,107,255,0.14)' }]}>
                  <Ionicons name={o.icon} size={16} color={c.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.rowTitle, { color: c.text }]}>{o.title}</Text>
                  <Text style={[styles.rowBody, { color: c.textSecondary }]}>{o.body}</Text>
                </View>
              </View>
            </View>
          ))}

          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <TermsLink onPress={openTerms} version={formatVersion(currentVersion)} inline />
        </Card>

        <Card>
          <View style={styles.cardHead}>
            <View style={[styles.cardIcon, { borderColor: 'rgba(74,143,229,0.45)' }]}>
              <Ionicons name="shield-checkmark-outline" size={17} color={c.primary} />
            </View>
            <CardTitle>Your confirmations</CardTitle>
          </View>
          {/* Never pre-checked, and never checked as a side effect of opening
              the terms — viewing and agreeing are separate acts. */}
          <CheckRow
            checked={agreedTerms}
            onToggle={() => setAgreedTerms((v) => !v)}
            text="I have read and agree to the Seller Terms and the applicable marketplace, payout, shipping, refund, return, dispute and prohibited-products policies."
          />
          {/* Specific to how this seller is registered — the three tax paths
              carry genuinely different obligations. */}
          {!!taxText && (
            <CheckRow checked={agreedTax} onToggle={() => setAgreedTax((v) => !v)} text={taxText} />
          )}
        </Card>

        {!!error && <Note tone="bad">{error}</Note>}

        <PrimaryCta
          label="Accept & Continue"
          onPress={accept}
          disabled={!canAccept}
          busy={busy}
        />
      </ScrollView>
    </>
  );
}

function TermsLink({
  onPress,
  version,
  inline,
}: {
  onPress: () => void;
  version: string | null;
  inline?: boolean;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Read the full Seller Terms${version ? `, version ${version}` : ''}`}
      accessibilityHint="Opens the Seller Terms in your browser. This does not accept them."
      style={({ pressed }) => [
        styles.termsRow,
        !inline && { borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: Spacing.three },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: 'rgba(46,107,255,0.14)' }]}>
        <Ionicons name="document-text-outline" size={16} color={c.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.termsText, { color: c.primary }]}>Read the full Seller Terms</Text>
        {!!version && (
          <Text style={[styles.rowBody, { color: c.textFaint }]}>Seller Terms version: {version}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  rowTitle: { fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  rowBody: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 16.5 },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    minHeight: 48,
  },
  termsText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
});
