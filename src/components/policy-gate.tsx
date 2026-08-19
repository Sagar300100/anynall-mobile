// Mandatory policy-acceptance gate — mobile port of the website's
// PolicyGateModal + usePolicyGate. Until now mobile users were never on
// record accepting the Terms, Privacy or Refund policies (the audit's
// "policy-acceptance gate: MISSING").
//
// Shows ONLY when: signed in + email verified + any of the three policies not
// yet accepted on users/{uid} (owner read is allowed by firestore.rules).
// Never to guests, never mid-load, never again after acceptance — and there
// is deliberately NO skip. Acceptance is written server-side (POST
// /api/profile/policy-acceptance), so a user can only ever stamp their own
// record; on a transient read failure the gate fails open rather than lock a
// paying user out (same policy as the web hook — the next sign-in re-checks).
import { doc, getDoc } from 'firebase/firestore';
import { router, usePathname } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { acceptPolicies } from '@/lib/api';
import { db } from '@/lib/firebase';
import { useSession } from '@/lib/session';

const POLICIES: { label: string; doc: string }[] = [
  { label: 'Terms & Conditions', doc: 'terms' },
  { label: 'Privacy Policy', doc: 'privacy' },
  { label: 'Returns, Refunds & Cancellation Policy', doc: 'refund' },
];

export function PolicyGate() {
  const c = useBrandColors();
  const { user } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A React Native Modal sits ABOVE the navigator, so pushing a legal page
  // from inside it would render underneath the gate. While the user is off
  // reading a policy the modal steps aside; the moment the route leaves
  // /legal/* it comes straight back — the gate is paused, never skipped.
  const [browsingPolicy, setBrowsingPolicy] = useState(false);

  useEffect(() => {
    if (!browsingPolicy || pathname.startsWith('/legal')) return;
    let cancelled = false;
    // Deferred a tick — the compiler rejects synchronous setState in effects.
    (async () => {
      await Promise.resolve();
      if (!cancelled) setBrowsingPolicy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [browsingPolicy, pathname]);

  function openPolicy(docKey: string) {
    setBrowsingPolicy(true);
    router.push(`/legal/${docKey}` as never);
  }

  useEffect(() => {
    let cancelled = false;
    // Session layer already treats unverified accounts as signed out, so a
    // present user here is verified. State writes are deferred a tick — the
    // compiler rejects synchronous setState in an effect body.
    if (!user) {
      (async () => {
        await Promise.resolve();
        if (!cancelled) setOpen(false);
      })();
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid)); // owner can read own
        if (cancelled) return;
        const d = snap.exists() ? (snap.data() as any) : {};
        const accepted =
          d.termsAccepted === true &&
          d.privacyAccepted === true &&
          d.refundPolicyAccepted === true;
        // Missing doc / missing flags ⇒ not accepted ⇒ gate.
        setOpen(!accepted);
      } catch {
        if (!cancelled) setOpen(false); // fail open on transient errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const onAccept = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await acceptPolicies();
      setOpen(false);
    } catch {
      setError("Couldn't record your acceptance. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, []);

  if (!open || browsingPolicy) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { backgroundColor: c.backgroundElement, borderColor: c.borderStrong }]}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.title, { color: c.text }]}>Before you continue</Text>
            <Text style={[styles.body, { color: c.textSecondary }]}>
              To use Any&All you need to accept our policies. They cover how buying, selling,
              payments and refunds work, and how your data is handled.
            </Text>

            <View style={[styles.links, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              {POLICIES.map((p, i) => (
                <View key={p.doc}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                  <Pressable
                    onPress={() => openPolicy(p.doc)}
                    accessibilityRole="link"
                    accessibilityLabel={`Read the ${p.label}`}
                    style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.65 }]}
                  >
                    <Text style={[styles.linkText, { color: c.primary }]}>{p.label}</Text>
                  </Pressable>
                </View>
              ))}
            </View>

            {!!error && <Text style={[styles.error, { color: c.danger }]}>{error}</Text>}

            <PrimaryButton
              title="I'm 18 or older and I accept all three"
              onPress={onAccept}
              loading={saving}
            />
            <Text style={[styles.fine, { color: c.textFaint }]}>
              Tapping accept records your agreement to the Terms & Conditions, Privacy Policy and
              Refund Policy, and confirms you are at least 18 years old.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(2,6,16,0.86)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    maxHeight: '80%',
  },
  scroll: { padding: Spacing.four, gap: Spacing.three },
  title: { fontSize: 20, fontFamily: Fonts.sansSemiBold },
  body: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 21 },
  links: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  linkRow: {
    paddingHorizontal: Spacing.three,
    minHeight: 48,
    justifyContent: 'center',
  },
  linkText: { fontSize: 14, fontFamily: Fonts.sansMedium },
  error: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },
  fine: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16, textAlign: 'center' },
});
