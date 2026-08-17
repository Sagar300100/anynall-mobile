// Legal — the policy documents, in the app.
//
// These used to open anynall.com in a browser (see the old ProfileFooter).
// That was wrong for two reasons: the buyer leaves the app at the exact moment
// they're checking whether they can get their money back, and the policies are
// unreadable on a phone-sized rendering of a desktop legal page. The text here
// is byte-identical to the website's — src/data/legal-content.ts is a verbatim
// copy — so nothing about what a user is agreeing to changes.
//
// Routes: /legal/terms · /legal/privacy · /legal/refund · /legal/pricing ·
//         /legal/contact
// An optional ?section= slug jumps to a heading (Help Center deep links).
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PolicyDocument } from '@/components/policy-document';
import { Eyebrow, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { PRICING_MD, PRIVACY_MD, REFUND_MD, TERMS_MD } from '@/data/legal-content';

export type LegalDoc = 'terms' | 'privacy' | 'refund' | 'pricing' | 'contact';

const DOCS: Record<Exclude<LegalDoc, 'contact'>, { title: string; markdown: string }> = {
  terms: { title: 'Terms & Conditions', markdown: TERMS_MD },
  privacy: { title: 'Privacy Policy', markdown: PRIVACY_MD },
  refund: { title: 'Returns, Refunds & Cancellation', markdown: REFUND_MD },
  pricing: { title: 'Pricing', markdown: PRICING_MD },
};

/** Company identity, verbatim from the website's LegalPage constants. */
const COMPANY = {
  legalName: 'Any&All Private Limited',
  address: '170/3, P L Sharma Road, Begum Bagh, Meerut – 250001, Uttar Pradesh, India',
  phone: '+91 99539 77809',
  cin: 'U62090UW2026PTC253793',
  gstin: '09ABFCA7940J1ZB',
  lastUpdated: '26 June 2026',
};

/** Built from the founder's "Contact Us Any&All.docx" (04 July 2026). */
const CONTACT_CARDS: {
  id: string;
  title: string;
  desc: string;
  emails: string[];
  note?: string;
}[] = [
  {
    id: 'buyer-support',
    title: 'Buyer Support',
    desc: 'Order issues, refunds, missing items, payment issues, delivery concerns, login problems, or account-related support.',
    emails: ['support@anynall.com'],
    note: 'Include your registered email/mobile number, order ID if applicable, and a short description of the issue.',
  },
  {
    id: 'seller-support',
    title: 'Seller Support',
    desc: 'Seller onboarding, KYC issues, product listings, live show issues, payouts, logistics, fees, account verification, or seller account support.',
    emails: ['support@anynall.com'],
    note: 'Include your registered email/mobile number, store name, and relevant order, payout, or listing details.',
  },
  {
    id: 'privacy-data-account-requests',
    title: 'Privacy, Data & Account Requests',
    desc: 'Privacy-related queries, data correction, account deletion, consent withdrawal, or questions about how your personal information is collected, used, or stored.',
    emails: ['privacy@anynall.com'],
  },
  {
    id: 'grievance-officer',
    title: 'Grievance Officer',
    desc: 'Formal complaints, unresolved platform issues, privacy grievances, user safety concerns, or complaints under applicable Indian laws and Any&All policies.',
    emails: ['grievance@anynall.com'],
    note: 'Include: name, registered email or mobile number, order ID or account details if applicable, a clear description of the issue, and screenshots, payment proof, delivery proof or other supporting documents, if any. We will review grievance requests and respond as per applicable law and our internal policies.',
  },
  {
    id: 'business-press-partnerships',
    title: 'Business, Press & Partnerships',
    desc: 'Business partnerships, brand collaborations, creator partnerships, press queries, marketplace opportunities, or management-level communication — sagar@anynall.com. For operations, seller coordination, creator support, or partnership assistance — muskaan@anynall.com.',
    emails: ['sagar@anynall.com', 'muskaan@anynall.com'],
  },
];

const OTHER_DOCS: { key: LegalDoc; label: string }[] = [
  { key: 'terms', label: 'Terms' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'refund', label: 'Refunds' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'contact', label: 'Contact' },
];

export default function LegalScreen() {
  const c = useBrandColors();
  const { doc, section } = useLocalSearchParams<{ doc?: string; section?: string }>();
  const key = (doc || 'terms') as LegalDoc;
  const isContact = key === 'contact';
  const entry = isContact ? null : DOCS[key as Exclude<LegalDoc, 'contact'>];

  // An unknown slug is a broken link, not a reason to show the wrong policy.
  if (!isContact && !entry) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <TopBar title="Legal" />
        <View style={styles.missing}>
          <Text style={[styles.missingText, { color: c.textSecondary }]}>
            That policy page doesn’t exist.
          </Text>
          <DocChips current={key} />
        </View>
      </SafeAreaView>
    );
  }

  const header = (
    <View style={styles.docHeader}>
      <Eyebrow>{isContact ? 'Get in touch' : 'Legal'}</Eyebrow>
      <Text style={[styles.docTitle, { color: c.text }]}>
        {isContact ? 'Contact Us' : entry!.title}
      </Text>
      <Text style={[styles.updated, { color: c.textFaint }]}>
        {COMPANY.legalName} · Last updated {COMPANY.lastUpdated}
      </Text>
    </View>
  );

  const footer = (
    <View style={styles.docFooter}>
      <View style={[styles.hairline, { backgroundColor: c.border }]} />
      <DocChips current={key} />
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <TopBar title={isContact ? 'Contact' : entry!.title} />
      {isContact ? (
        <ContactBody header={header} footer={footer} />
      ) : (
        <PolicyDocument
          markdown={entry!.markdown}
          sectionId={section || undefined}
          header={header}
          footer={footer}
        />
      )}
    </SafeAreaView>
  );
}

function ContactBody({ header, footer }: { header: React.ReactNode; footer: React.ReactNode }) {
  const c = useBrandColors();
  return (
    <ScrollView contentContainerStyle={styles.contactScroll} showsVerticalScrollIndicator={false}>
      {header}
      <Text style={[styles.body, { color: c.textSecondary }]}>
        We’re a small team and we read every message. The fastest way to reach us depends on what
        you need.
      </Text>

      {CONTACT_CARDS.map((card) => (
        <View
          key={card.id}
          style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}
        >
          <Text style={[styles.cardTitle, { color: c.text }]}>{card.title}</Text>
          <Text style={[styles.body, { color: c.textSecondary }]}>{card.desc}</Text>
          <View style={styles.emailRow}>
            {card.emails.map((email) => (
              <Pressable
                key={email}
                onPress={() => Linking.openURL(`mailto:${email}`).catch(() => {})}
                accessibilityRole="link"
                accessibilityLabel={`Email ${email}`}
                style={({ pressed }) => [
                  styles.emailChip,
                  { borderColor: c.borderStrong, opacity: pressed ? 0.65 : 1 },
                ]}
              >
                <Ionicons name="mail-outline" size={14} color={c.primary} />
                <Text style={[styles.emailText, { color: c.primary }]}>{email}</Text>
              </Pressable>
            ))}
          </View>
          {!!card.note && (
            <Text style={[styles.note, { color: c.textFaint }]}>{card.note}</Text>
          )}
        </View>
      ))}

      <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
        <Text style={[styles.cardTitle, { color: c.text }]}>Registered office</Text>
        <Text style={[styles.body, { color: c.textSecondary }]}>{COMPANY.legalName}</Text>
        <Text style={[styles.body, { color: c.textSecondary }]}>{COMPANY.address}</Text>
        <Pressable
          onPress={() => Linking.openURL(`tel:${COMPANY.phone.replace(/\s/g, '')}`).catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel={`Call ${COMPANY.phone}`}
          style={({ pressed }) => [
            styles.emailChip,
            styles.phoneChip,
            { borderColor: c.borderStrong, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Ionicons name="call-outline" size={14} color={c.primary} />
          <Text style={[styles.emailText, { color: c.primary }]}>{COMPANY.phone}</Text>
        </Pressable>
        <Text style={[styles.note, { color: c.textFaint }]}>
          CIN {COMPANY.cin} · GSTIN {COMPANY.gstin}
        </Text>
      </View>

      {footer}
    </ScrollView>
  );
}

/** Cross-links between the policies — the same chips the website carries. */
function DocChips({ current }: { current: LegalDoc }) {
  const c = useBrandColors();
  return (
    <View style={styles.chips}>
      {OTHER_DOCS.filter((d) => d.key !== current).map((d) => (
        <Pressable
          key={d.key}
          onPress={() => router.replace(`/legal/${d.key}` as never)}
          accessibilityRole="link"
          accessibilityLabel={d.label}
          style={({ pressed }) => [
            styles.chip,
            { borderColor: c.border, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Text style={[styles.chipText, { color: c.textSecondary }]}>{d.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function TopBar({ title }: { title: string }) {
  const c = useBrandColors();
  return (
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
      <Text style={[styles.topTitle, { color: c.text }]} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 17, fontFamily: Fonts.sansSemiBold },

  docHeader: { gap: Spacing.one + 2, paddingTop: Spacing.one, paddingBottom: Spacing.three },
  docTitle: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.5 },
  updated: { fontSize: 12, fontFamily: Fonts.sans },
  docFooter: { marginTop: Spacing.five, gap: Spacing.three },
  hairline: { height: StyleSheet.hairlineWidth },

  contactScroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  body: { fontFamily: Fonts.sans, fontSize: 14.5, lineHeight: 22 },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  cardTitle: { fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  emailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  emailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    minHeight: 40,
  },
  phoneChip: { alignSelf: 'flex-start' },
  emailText: { fontSize: 13, fontFamily: Fonts.sansMedium },
  note: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 18 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontFamily: Fonts.sansMedium },

  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  missingText: { fontSize: 14.5, fontFamily: Fonts.sans },
});
