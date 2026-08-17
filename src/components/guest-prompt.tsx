// Shared signed-out state for account-scoped tabs.
//
// Deliberately states what the tab *would* hold for a signed-in user rather
// than showing placeholder rows — no fake messages, saved items or order
// updates anywhere in this app.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GradientCTA } from '@/components/auth-ui';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import type { GatedAction } from '@/lib/auth-gate';

export function GuestPrompt({
  icon,
  title,
  body,
  points,
  reason,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  /** What this tab actually contains once signed in. */
  points?: string[];
  reason: GatedAction;
}) {
  const c = useBrandColors();
  return (
    <View style={styles.root}>
      <View style={[styles.iconRing, { borderColor: 'rgba(120,150,210,0.24)' }]}>
        <Ionicons name={icon} size={26} color={c.primary} />
      </View>

      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      <Text style={[styles.body, { color: c.textSecondary }]}>{body}</Text>

      {!!points?.length && (
        <View style={styles.points}>
          {points.map((p) => (
            <View key={p} style={styles.pointRow}>
              <Ionicons name="checkmark" size={14} color={c.primary} />
              <Text style={[styles.pointText, { color: c.textSecondary }]}>{p}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <GradientCTA
          title="Sign in"
          onPress={() => router.push({ pathname: '/sign-in', params: { reason } })}
        />
        <Pressable
          onPress={() => router.push('/sign-up')}
          accessibilityRole="button"
          accessibilityLabel="Create an account"
          style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.secondaryText, { color: c.primary }]}>Create an account</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four + Spacing.one,
    gap: Spacing.two,
  },
  iconRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  title: { fontSize: 19, fontFamily: Fonts.sansSemiBold, textAlign: 'center' },
  body: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 320,
  },
  points: { gap: Spacing.two, marginTop: Spacing.three, alignSelf: 'stretch', maxWidth: 320 },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pointText: { flex: 1, fontSize: 13.5, fontFamily: Fonts.sans },
  actions: { alignSelf: 'stretch', maxWidth: 320, gap: Spacing.two, marginTop: Spacing.four },
  secondary: { alignSelf: 'center', paddingVertical: Spacing.two, minHeight: 44, justifyContent: 'center' },
  secondaryText: { fontSize: 14.5, fontFamily: Fonts.sansMedium },
});
