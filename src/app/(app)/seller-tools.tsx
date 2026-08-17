// Seller Tools — full-screen sub-page of the Seller Hub hamburger.
//
// The menu is EXACTLY the fifteen rows in the approved reference, in five
// groups. Nothing added: no Help & Support, no Bank Details, no Store
// Information, no Return/Refund settings, no Logout, no Premier Shop.
//
// Only Inventory has a real screen today. The other thirteen navigate to
// /seller-tool/[slug], which states plainly that the tool isn't built rather
// than faking one — and Vacation Mode is a real server-persisted toggle, not
// a decorative switch.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/components/step5-parts';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { getSellerOnboarding, setVacationMode } from '@/lib/seller';

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  href: string;
  /** Ionicons has no rupee glyph, so Payouts draws ₹ as text instead — the
   *  spec requires a rupee mark, never a dollar or pound. */
  glyph?: string;
};

const MANAGE: Row[] = [
  { icon: 'pricetag-outline', label: 'Inventory', href: '/inventory' },
  { icon: 'videocam-outline', label: 'Shows', href: '/seller-tool/shows' },
  { icon: 'pricetags-outline', label: 'Offers', href: '/seller-tool/offers' },
];

const SALES: Row[] = [
  { icon: 'cash-outline', label: 'Payouts', href: '/seller-tool/payouts', glyph: '₹' },
  { icon: 'car-outline', label: 'Fulfilment', href: '/seller-tool/fulfilment' },
  { icon: 'receipt-outline', label: 'Orders', href: '/seller-tool/orders' },
  { icon: 'bulb-outline', label: 'Tips', href: '/seller-tool/tips' },
];

const PROMOTIONS: Row[] = [
  { icon: 'people-outline', label: 'Refer Buyers, Gain Followers', href: '/seller-tool/refer' },
  { icon: 'megaphone-outline', label: 'Promote Tools', href: '/seller-tool/promote' },
];

const PERFORMANCE: Row[] = [
  { icon: 'bar-chart-outline', label: 'Seller Analytics', href: '/seller-tool/analytics' },
  { icon: 'shield-checkmark-outline', label: 'Account Health', href: '/seller-tool/account-health' },
];

const SETTINGS: Row[] = [
  { icon: 'car-outline', label: 'Shipping Settings', href: '/seller-tool/shipping' },
  { icon: 'list-outline', label: 'Seller Status', href: '/seller-tool/seller-status' },
  { icon: 'chatbox-outline', label: 'Rehearsal Mode', href: '/seller-tool/rehearsal' },
];

export default function SellerToolsScreen() {
  const c = useBrandColors();
  const [vacation, setVacation] = useState(false);
  const [saving, setSaving] = useState(false);

  // Server state is the source of truth, so the toggle survives a restart.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const s = await getSellerOnboarding();
          if (!cancelled) setVacation(s.vacationMode === true);
        } catch {
          /* leave the last known value rather than flipping it under them */
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  async function toggleVacation(next: boolean) {
    const previous = vacation;
    setVacation(next); // optimistic
    setSaving(true);
    try {
      await setVacationMode(next);
    } catch {
      // Restore the previous value — the switch must never claim a state the
      // server didn't accept.
      setVacation(previous);
      Alert.alert('Couldn’t update Vacation Mode', 'Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/sell'))}
          accessibilityRole="button"
          accessibilityLabel="Back to Seller Hub"
          hitSlop={10}
          style={({ pressed }) => [
            styles.backBtn,
            { borderColor: c.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="chevron-back" size={20} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Seller Tools</Text>
        {/* Balances the back button so the title stays optically centred. */}
        <View style={styles.backBtnGhost} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: TAB_BAR_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        <Group title="Manage" rows={MANAGE} />
        <Group title="Sales" rows={SALES} />
        <Group title="Promotions" rows={PROMOTIONS} />
        <Group title="Performance" rows={PERFORMANCE} />

        <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
          <Text style={[styles.groupTitle, { color: c.text }]}>Settings</Text>
          {SETTINGS.map((r, i) => (
            <RowItem key={r.label} row={r} first={i === 0} />
          ))}
          <View style={[styles.row, styles.rowDivider, { borderTopColor: c.border }]}>
            <View style={[styles.rowIcon, { backgroundColor: 'rgba(46,107,255,0.14)' }]}>
              <Ionicons name="airplane-outline" size={18} color={c.primary} />
            </View>
            <Text style={[styles.rowLabel, { color: c.text }]}>Vacation Mode</Text>
            <Switch
              value={vacation}
              onValueChange={toggleVacation}
              disabled={saving}
              accessibilityLabel="Vacation Mode"
              accessibilityState={{ checked: vacation, disabled: saving }}
              trackColor={{ false: 'rgba(120,150,210,0.3)', true: '#2E6BFF' }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ title, rows }: { title: string; rows: Row[] }) {
  const c = useBrandColors();
  return (
    <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
      <Text style={[styles.groupTitle, { color: c.text }]}>{title}</Text>
      {rows.map((r, i) => (
        <RowItem key={r.label} row={r} first={i === 0} />
      ))}
    </View>
  );
}

/** Rows sit inside one grouped card, separated by hairlines — not as
 *  individual cards, which reads as a wall of boxes. */
function RowItem({ row, first }: { row: Row; first: boolean }) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={() => router.push(row.href as never)}
      accessibilityRole="button"
      accessibilityLabel={row.label}
      style={({ pressed }) => [
        styles.row,
        !first && styles.rowDivider,
        !first && { borderTopColor: c.border },
        pressed && { opacity: 0.65 },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: 'rgba(46,107,255,0.14)' }]}>
        {row.glyph ? (
          <Text style={[styles.rowGlyph, { color: c.primary }]}>{row.glyph}</Text>
        ) : (
          <Ionicons name={row.icon} size={18} color={c.primary} />
        )}
      </View>
      <Text style={[styles.rowLabel, { color: c.text }]} numberOfLines={2}>
        {row.label}
      </Text>
      <Ionicons name="chevron-forward" size={17} color={c.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    minHeight: 48,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnGhost: { width: 38, height: 38 },
  topTitle: { flex: 1, fontSize: 20, fontFamily: Fonts.sansSemiBold, textAlign: 'center' },

  scroll: { paddingHorizontal: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two + 2 },
  group: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two + Spacing.one,
    paddingBottom: Spacing.one,
  },
  groupTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one, minHeight: 54 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: 14.5, fontFamily: Fonts.sans },
  rowGlyph: { fontSize: 17, fontFamily: Fonts.sansSemiBold },
});
