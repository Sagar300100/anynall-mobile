// Route shell for Seller Tools destinations that have no screen yet.
//
// Inventory, Orders/Fulfilment, Shipping Settings and Seller Analytics now
// have real screens. Rather than fake the remaining tools — or wire dead rows
// that do nothing — each unimplemented one navigates here and says plainly
// that it isn't built, offering the web hub when the web genuinely has it.
// Nothing here pretends to be functionality.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/components/step5-parts';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

const WEB_HUB = 'https://anynall.com';

/** slug → display name and whether the web hub actually covers it today. */
const TOOLS: Record<string, { title: string; onWeb: boolean }> = {
  shows: { title: 'Shows', onWeb: true },
  offers: { title: 'Offers', onWeb: false },
  payouts: { title: 'Payouts', onWeb: true },
  tips: { title: 'Tips', onWeb: false },
  refer: { title: 'Refer Buyers, Gain Followers', onWeb: false },
  promote: { title: 'Promote Tools', onWeb: false },
  'account-health': { title: 'Account Health', onWeb: false },
  'seller-status': { title: 'Seller Status', onWeb: false },
  rehearsal: { title: 'Rehearsal Mode', onWeb: false },
};

export default function SellerToolShell() {
  const c = useBrandColors();
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const tool = TOOLS[String(slug ?? '')] ?? { title: 'Seller tool', onWeb: false };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/seller-tools'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]} numberOfLines={1}>
          {tool.title}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: TAB_BAR_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
          <View style={[styles.icon, { backgroundColor: 'rgba(46,107,255,0.14)' }]}>
            <Ionicons name="construct-outline" size={22} color={c.primary} />
          </View>
          <Text style={[styles.title, { color: c.text }]}>Not in the app yet</Text>
          <Text style={[styles.body, { color: c.textSecondary }]}>
            {tool.onWeb
              ? `${tool.title} isn’t built into the app yet. You can manage it on the web Seller Hub in the meantime.`
              : `${tool.title} isn’t available yet. It’ll appear here once it’s built — nothing is hidden behind this screen.`}
          </Text>
          {tool.onWeb && (
            <Pressable
              onPress={() => WebBrowser.openBrowserAsync(WEB_HUB).catch(() => {})}
              accessibilityRole="link"
              accessibilityLabel={`Open ${tool.title} on anynall.com`}
              style={({ pressed }) => [
                styles.cta,
                { borderColor: 'rgba(74,143,229,0.55)' },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.ctaText, { color: c.primary }]}>Open on anynall.com</Text>
              <Ionicons name="open-outline" size={15} color={c.primary} />
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
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
    paddingBottom: Spacing.one,
    minHeight: 44,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 21, fontFamily: Fonts.sansSemiBold },
  scroll: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  icon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  body: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18.5, textAlign: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    marginTop: Spacing.one,
  },
  ctaText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
});
