// Account menu primitives for the Profile tab.
//
// One grouped surface with hairline dividers — not a stack of individual
// cards. Icons are plain Ionicons glyphs (22dp, no boxed containers), rows
// meet the 48dp touch minimum, and every row navigates somewhere real:
// nothing here is decorative.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, Fragment, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

const DANGER = '#E5484D';
const PRESSED_BG = 'rgba(120,150,210,0.07)';

/** Rounded surface that renders its children separated by inset hairlines. */
export function MenuGroup({ children }: { children: ReactNode }) {
  const c = useBrandColors();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

export function MenuRow({
  icon,
  label,
  support,
  onPress,
  loading = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  support: string;
  onPress: () => void;
  /** Replaces the chevron with a spinner and ignores presses while true. */
  loading?: boolean;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={support}
      accessibilityState={{ busy: loading }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: PRESSED_BG }]}
    >
      <Ionicons name={icon} size={22} color={c.primary} />
      <View style={styles.text}>
        <Text style={[styles.label, { color: c.text }]}>{label}</Text>
        <Text style={[styles.support, { color: c.textSecondary }]} numberOfLines={2}>
          {support}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={c.textSecondary} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
      )}
    </Pressable>
  );
}

/**
 * Card-style menu row (approved signed-in Profile mock): each row is its own
 * rounded surface with the icon inside a rounded-square tinted box.
 */
export function CardRow({
  icon,
  label,
  support,
  onPress,
  loading = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  support: string;
  onPress: () => void;
  loading?: boolean;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={support}
      accessibilityState={{ busy: loading }}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.cardBackground, borderColor: c.border },
        pressed && { backgroundColor: 'rgba(120,150,210,0.10)' },
      ]}
    >
      <View style={[styles.cardIcon, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
        <Ionicons name={icon} size={19} color={c.primary} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.cardLabel, { color: c.text }]}>{label}</Text>
        <Text style={[styles.support, { color: c.textSecondary }]} numberOfLines={2}>
          {support}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={c.textSecondary} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
      )}
    </Pressable>
  );
}

/** Destructive sign-out row on its own subtly red-tinted surface. */
export function SignOutRow({ onPress, busy = false }: { onPress: () => void; busy?: boolean }) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      accessibilityHint="Signs you out of your Any&All account"
      accessibilityState={{ busy }}
      style={({ pressed }) => [
        styles.group,
        styles.signOut,
        { backgroundColor: c.cardBackground },
        pressed && { backgroundColor: 'rgba(229,72,77,0.06)' },
      ]}
    >
      <View style={styles.row}>
        <Ionicons name="log-out-outline" size={20} color={DANGER} />
        <View style={styles.text}>
          <Text style={[styles.label, { color: DANGER }]}>Sign out</Text>
          <Text style={[styles.support, { color: c.textSecondary }]}>
            Sign out of your Any&All account
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={DANGER} />
        ) : (
          <Ionicons name="chevron-forward" size={16} color="rgba(229,72,77,0.55)" />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  // Inset so the line starts where the text starts (icon 22 + gap 14 + pad 16).
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    minHeight: 52,
  },
  text: { flex: 1, gap: 1 },
  label: { fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  support: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 16 },
  signOut: { borderColor: 'rgba(229,72,77,0.28)' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 56,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: { fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
});
