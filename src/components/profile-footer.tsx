// Shared footer for both Profile states (guest + signed in): dynamic app
// version from config — never hardcoded — and the real legal pages.
//
// Legal/Privacy open the IN-APP documents (/legal/*) — same verbatim text as
// the site, readable at phone size, no browser bounce. About stays a site
// link: the About page is a marketing surface the app deliberately doesn't
// carry (see PRODUCT.md anti-references).
import Constants from 'expo-constants';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

const SITE = 'https://anynall.com';

export function openSite(path: string) {
  WebBrowser.openBrowserAsync(`${SITE}${path}`).catch(() => {});
}

const LINKS: { label: string; open: () => void }[] = [
  { label: 'Legal', open: () => router.push('/legal/terms') },
  { label: 'Privacy', open: () => router.push('/legal/privacy') },
  { label: 'About Any&All', open: () => openSite('/about') },
];

export function ProfileFooter() {
  const c = useBrandColors();
  const version = Constants.expoConfig?.version;
  return (
    <View style={styles.footer}>
      {!!version && (
        <Text style={[styles.footerVersion, { color: c.textFaint }]}>App version {version}</Text>
      )}
      <View style={styles.footerLinks}>
        {LINKS.map(({ label, open }, i) => (
          <View key={label} style={styles.footerLinkWrap}>
            {i > 0 && <Text style={[styles.footerDot, { color: c.textFaint }]}>·</Text>}
            <Pressable
              onPress={open}
              accessibilityRole="link"
              accessibilityLabel={label}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[styles.footerLink, { color: c.textSecondary }]}>{label}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  footerVersion: { fontSize: 12, fontFamily: Fonts.sans },
  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  footerLinkWrap: { flexDirection: 'row', alignItems: 'center' },
  footerDot: { fontSize: 12, marginHorizontal: Spacing.two },
  footerLink: { fontSize: 13, fontFamily: Fonts.sansMedium, paddingVertical: 6 },
});
