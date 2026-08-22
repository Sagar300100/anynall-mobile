// Settings — reached from the gear on the Profile tab.
//
// Phase 2 of web parity turned this from a two-row stub into the account's
// security home, mirroring the real features of the website's Account
// Settings (2FA, revoke sessions, data export, delete account) plus a real
// in-app password change (the site only stubs it). The account EMAIL is
// permanent by product decision — the row states it instead of offering a
// change flow. Every row is a real action — no fake toggles, no placeholder
// preferences.
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuGroup, MenuRow } from '@/components/account-menu';
import { Eyebrow } from '@/components/brand/eyebrow';
import { GradientCTA } from '@/components/brand/gradient-cta';
import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { exportMyData, hasPasswordProvider, isTwoFactorEnrolled } from '@/lib/account';
import { useAuthStatus } from '@/lib/auth-gate';
import { redeemReferral, referralRedeemError } from '@/lib/credits';
import {
  canNotify,
  getPushPreference,
  registerForPush,
  setPushPreference,
  unregisterPush,
} from '@/lib/push';
import { useSession } from '@/lib/session';
import { getPublicProfile, setAccountPrivacy } from '@/lib/users';

export default function SettingsScreen() {
  const c = useBrandColors();
  const { user } = useSession();
  const status = useAuthStatus();
  const [exporting, setExporting] = useState(false);
  const [twoFactorOn, setTwoFactorOn] = useState(false);

  // Re-check on every focus: the user may have just enrolled or unenrolled
  // on the Two-factor screen and come back.
  useFocusEffect(
    useCallback(() => {
      setTwoFactorOn(isTwoFactorEnrolled());
    }, [])
  );

  // Private account (Instagram-style). null = still loading the current value
  // from publicProfiles/{uid} — the switch is disabled until it arrives, so a
  // toggle can never fire against an unknown baseline.
  const [privateAcct, setPrivateAcct] = useState<boolean | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      (async () => {
        const p = await getPublicProfile(user.uid);
        if (!cancelled) setPrivateAcct(p?.isPrivate === true);
      })();
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  async function togglePrivacy(next: boolean) {
    if (privacyBusy || privateAcct === null) return;
    const prev = privateAcct;
    setPrivateAcct(next); // optimistic; rolled back below
    setPrivacyBusy(true);
    try {
      await setAccountPrivacy(next);
    } catch {
      setPrivateAcct(prev);
      Alert.alert(
        'Couldn’t update privacy',
        'Your account privacy wasn’t changed. Please try again.'
      );
    } finally {
      setPrivacyBusy(false);
    }
  }

  // Push notifications on THIS device. null = still reading the stored
  // preference + OS permission — the switch is disabled until both arrive.
  // The value shown is preference AND permission: an "on" switch while the
  // OS blocks the app would be a fake toggle.
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [pref, allowed] = await Promise.all([getPushPreference(), canNotify()]);
        if (!cancelled) setPushOn(pref && allowed);
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  async function togglePush(next: boolean) {
    if (pushBusy || pushOn === null) return;
    const prev = pushOn;
    setPushOn(next); // optimistic; rolled back below
    setPushBusy(true);
    try {
      await setPushPreference(next);
      if (next) {
        // Registers the device + posts the token; may show the OS permission
        // prompt if it was never granted. Never throws.
        const result = await registerForPush();
        if (result !== 'registered') {
          // Honest rollback — the OS refused or this device can't do push.
          await setPushPreference(false);
          setPushOn(false);
          Alert.alert(
            'Couldn’t turn on notifications',
            result === 'denied'
              ? 'Notifications are blocked for Any&All in your device settings. Allow them there, then try again.'
              : result === 'unavailable'
                ? 'Push notifications aren’t available on this device.'
                : 'Something went wrong. Please check your connection and try again.'
          );
        }
      } else {
        // Preference off + this device's token removed server-side (a silent
        // no-op while the push backend wave hasn't landed).
        await unregisterPush();
      }
    } catch {
      setPushOn(prev);
    } finally {
      setPushBusy(false);
    }
  }

  // ── Referral code (spec Gap 6) ──
  // The row hides SOFTLY once this account has redeemed (or the server said
  // it never can — already referred / already purchased): a local per-uid
  // flag, not a server field, because the profile doesn't expose referredBy.
  // Worst case the row reappears on a new device and the server refuses
  // again with the same honest message.
  const referralDoneKey = user ? `anynall:referral-redeemed:${user.uid}` : null;
  const [referralHidden, setReferralHidden] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralErr, setReferralErr] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!referralDoneKey) return;
      let cancelled = false;
      AsyncStorage.getItem(referralDoneKey)
        .then((v) => {
          if (!cancelled) setReferralHidden(v === '1');
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [referralDoneKey])
  );

  async function applyReferral() {
    const code = referralCode.trim();
    if (!code || referralBusy) return;
    setReferralBusy(true);
    setReferralErr(null);
    try {
      await redeemReferral(code);
      setReferralOpen(false);
      setReferralHidden(true);
      if (referralDoneKey) AsyncStorage.setItem(referralDoneKey, '1').catch(() => {});
      Alert.alert(
        'Referral code applied',
        'You’re linked. The credit for you both lands after your first purchase.'
      );
    } catch (e) {
      const { message, terminal } = referralRedeemError(e);
      if (terminal) {
        // This account can never redeem — hide the entry point softly.
        setReferralOpen(false);
        setReferralHidden(true);
        if (referralDoneKey) AsyncStorage.setItem(referralDoneKey, '1').catch(() => {});
        Alert.alert('Referral code', message);
      } else {
        setReferralErr(message);
      }
    } finally {
      setReferralBusy(false);
    }
  }

  async function exportData() {
    setExporting(true);
    try {
      const data = await exportMyData();
      // No file-system dependency: hand the JSON to the native share sheet,
      // where the user picks where it goes (Drive, mail, files…).
      await Share.share({
        title: `anynall-my-data-${new Date().toISOString().slice(0, 10)}.json`,
        message: JSON.stringify(data, null, 2),
      });
    } catch {
      Alert.alert('Export failed', 'Could not export your data right now. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  const passwordAccount = hasPasswordProvider();

  return (
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <PressScale
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </PressScale>
        <Text style={[styles.topTitle, { color: c.text }]}>Settings</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="settings-outline"
          title="Sign in to manage settings"
          body="Account settings become available once you’re signed in."
          reason="profile"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Eyebrow style={styles.sectionLabel}>Account</Eyebrow>
          <MenuGroup>
            {/* Informational row — not a button, so no chevron and no press state. */}
            <View
              style={styles.infoRow}
              accessible
              accessibilityLabel={`Email, ${user?.email ?? ''}, permanent`}
            >
              <Ionicons name="mail-outline" size={22} color={c.primary} />
              <View style={styles.infoText}>
                <Text style={[styles.infoLabel, { color: c.text }]}>Email</Text>
                <Text style={[styles.infoValue, { color: c.textSecondary }]} numberOfLines={1}>
                  {user?.email}
                </Text>
                {/* Product decision: the account email is PERMANENT — say so,
                    rather than leaving users hunting for a change flow. */}
                <Text style={[styles.infoNote, { color: c.textFaint }]}>
                  Permanent — this account stays on this email
                </Text>
              </View>
              {user?.emailVerified && (
                <View style={[styles.badge, { borderColor: 'rgba(74,143,229,0.4)' }]}>
                  <Text style={[styles.badgeText, { color: c.primary }]}>Verified</Text>
                </View>
              )}
            </View>
            <MenuRow
              icon="finger-print-outline"
              label="Verified buyer status"
              support="Verify your identity with Aadhaar via DigiLocker"
              onPress={() => router.push('/account/verify-identity')}
            />
            <MenuRow
              icon="key-outline"
              label="Change password"
              support={
                passwordAccount
                  ? 'Update it here, or reset by email'
                  : 'Your sign-in provider handles this'
              }
              onPress={() => router.push('/account/change-password')}
            />
          </MenuGroup>

          <Eyebrow style={styles.sectionLabel}>Shopping</Eyebrow>
          <MenuGroup>
            <MenuRow
              icon="location-outline"
              label="Delivery address"
              support="The address every checkout ships to"
              onPress={() => router.push('/account/address')}
            />
            <MenuRow
              icon="card-outline"
              label="Payments"
              support="Which method checkout opens on"
              onPress={() => router.push('/account/payments')}
            />
            {/* Hidden softly once redeemed (or the server said this account
                never can) — see the referral state above. */}
            {!referralHidden && (
              <MenuRow
                icon="gift-outline"
                label="Enter referral code"
                support="A friend’s @handle — you both earn credit after your first purchase"
                onPress={() => {
                  setReferralErr(null);
                  setReferralCode('');
                  setReferralOpen(true);
                }}
              />
            )}
          </MenuGroup>

          <Eyebrow style={styles.sectionLabel}>Notifications</Eyebrow>
          <MenuGroup>
            {/* Toggle row like Private account — flips in place, no navigation.
                Registers/unregisters this device's Expo push token (lib/push.ts).
                Honest copy: local show reminders are OS alarms, not push, so
                they keep working with this off. */}
            <View style={styles.infoRow}>
              <Ionicons name="notifications-outline" size={22} color={c.primary} />
              <View style={styles.infoText}>
                <Text style={[styles.infoLabel, { color: c.text }]}>Push notifications</Text>
                <Text style={[styles.infoValue, { color: c.textSecondary }]}>
                  Go-live alerts, auction wins, and order updates on this device.
                  Show reminders you set yourself still fire either way.
                </Text>
              </View>
              <Switch
                value={pushOn === true}
                onValueChange={togglePush}
                disabled={pushOn === null || pushBusy}
                accessibilityLabel="Push notifications"
                trackColor={{ false: 'rgba(120,150,210,0.35)', true: Brand.blueSky }}
                thumbColor="#FFFFFF"
              />
            </View>
          </MenuGroup>

          <Eyebrow style={styles.sectionLabel}>Security</Eyebrow>
          <MenuGroup>
            <MenuRow
              icon={twoFactorOn ? 'shield-checkmark-outline' : 'shield-outline'}
              label="Two-factor authentication"
              support={
                twoFactorOn
                  ? 'On — a code is required at each sign-in'
                  : 'Add a sign-in code from an authenticator app'
              }
              onPress={() => router.push('/account/two-factor')}
            />
            <MenuRow
              icon="log-out-outline"
              label="Sign out everywhere"
              support="Revoke every other device’s session"
              onPress={() => router.push('/account/sessions')}
            />
          </MenuGroup>

          <Eyebrow style={styles.sectionLabel}>Privacy & Data</Eyebrow>
          <MenuGroup>
            {/* Toggle row, not a MenuRow — it flips a value in place rather
                than navigating. Writes publicProfiles/{uid}.isPrivate, the
                same field the web client and firestore.rules gate follows on. */}
            <View style={styles.infoRow}>
              <Ionicons name="lock-closed-outline" size={22} color={c.primary} />
              <View style={styles.infoText}>
                <Text style={[styles.infoLabel, { color: c.text }]}>Private account</Text>
                <Text style={[styles.infoValue, { color: c.textSecondary }]}>
                  Only approved followers can see your shows and activity — new
                  followers need your approval. Your name and photo stay findable.
                </Text>
              </View>
              <Switch
                value={privateAcct === true}
                onValueChange={togglePrivacy}
                disabled={privateAcct === null || privacyBusy}
                accessibilityLabel="Private account"
                trackColor={{ false: 'rgba(120,150,210,0.35)', true: Brand.blueSky }}
                thumbColor="#FFFFFF"
              />
            </View>
            <MenuRow
              icon="download-outline"
              label="Export my data"
              support="Everything we hold about you, as JSON"
              onPress={exportData}
              loading={exporting}
            />
            <MenuRow
              icon="trash-outline"
              label="Delete account"
              support="Permanently erase your account and data"
              onPress={() => router.push('/account/delete')}
            />
          </MenuGroup>

          <Eyebrow style={styles.sectionLabel}>Help & Legal</Eyebrow>
          <MenuGroup>
            <MenuRow
              icon="help-circle-outline"
              label="Help Center"
              support="FAQs, the assistant and support tickets"
              onPress={() => router.push('/help')}
            />
            <MenuRow
              icon="document-text-outline"
              label="Terms & Conditions"
              support="The rules of using Any&All"
              onPress={() => router.push('/legal/terms')}
            />
            <MenuRow
              icon="lock-closed-outline"
              label="Privacy Policy"
              support="How your data is collected and used"
              onPress={() => router.push('/legal/privacy')}
            />
            <MenuRow
              icon="return-down-back-outline"
              label="Returns & Refunds"
              support="When and how you get your money back"
              onPress={() => router.push('/legal/refund')}
            />
          </MenuGroup>
        </ScrollView>
      )}

      {/* Referral code entry (spec Gap 6) */}
      <Modal
        visible={referralOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setReferralOpen(false)}
      >
        <View style={styles.sheetScrim}>
          <View
            style={[styles.sheet, { backgroundColor: Brand.ink800, borderColor: Brand.hairline }]}
          >
            <View style={styles.sheetHead}>
              <Text style={[styles.sheetTitle, { color: c.text }]}>Referral code</Text>
              <PressScale
                onPress={() => setReferralOpen(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close referral code entry"
              >
                <Ionicons name="close" size={20} color={c.textSecondary} />
              </PressScale>
            </View>
            <Text style={[styles.sheetBody, { color: c.textSecondary }]}>
              Enter the @handle of the member who invited you. It only works before your first
              purchase — the credit for you both arrives once that purchase is paid.
            </Text>
            <View
              style={[styles.codeField, { borderColor: Brand.hairlineWhite, backgroundColor: 'rgba(255,255,255,0.05)' }]}
            >
              <Text style={[styles.codeAt, { color: c.textSecondary }]}>@</Text>
              <TextInput
                value={referralCode}
                onChangeText={setReferralCode}
                placeholder="theirhandle"
                placeholderTextColor={c.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                maxLength={30}
                accessibilityLabel="Referral code"
                style={[styles.codeInput, { color: c.text }]}
                onSubmitEditing={applyReferral}
                returnKeyType="done"
              />
            </View>
            {!!referralErr && (
              <Text style={[styles.codeError, { color: c.danger }]}>{referralErr}</Text>
            )}
            <GradientCTA
              title={referralBusy ? 'Applying…' : 'Apply code'}
              onPress={applyReferral}
              disabled={referralBusy || !referralCode.trim()}
            />
          </View>
        </View>
      </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
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
  topTitle: { fontSize: 20, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  scroll: { padding: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.five, gap: Spacing.two },
  sectionLabel: { marginLeft: 4, marginTop: Spacing.two },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    minHeight: 56,
  },
  infoText: { flex: 1, gap: 1 },
  infoLabel: { fontSize: 15, fontFamily: Fonts.uiSemiBold },
  infoValue: { fontSize: 12.5, fontFamily: Fonts.ui },
  infoNote: { fontSize: 11, fontFamily: Fonts.ui, marginTop: 1 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontFamily: Fonts.uiSemiBold },

  // ── Referral sheet ──
  sheetScrim: {
    flex: 1,
    backgroundColor: 'rgba(2,6,16,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  sheetBody: { fontSize: 13.5, fontFamily: Fonts.ui, lineHeight: 20 },
  codeField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
  },
  codeAt: { fontSize: 16, fontFamily: Fonts.uiSemiBold },
  codeInput: { flex: 1, fontSize: 16, fontFamily: Fonts.ui, padding: 0 },
  codeError: { fontSize: 12.5, fontFamily: Fonts.ui, lineHeight: 18 },
});
