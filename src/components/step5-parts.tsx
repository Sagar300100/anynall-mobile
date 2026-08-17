// Shared building blocks for onboarding Step 5 (Enrolment / GST).
//
// Step 5 shows one of three things depending on the tax status chosen at
// Step 2 — unregistered enrolment, composition GSTIN, or regular GSTIN — but
// it is ONE screen with conditional content, not three designs. Everything
// visual lives here so the three paths cannot drift apart: same hero, same
// cards, same detail rows, same status panels, same CTA.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageSource } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

/** Tab bar (58) + breathing room, added to the safe-area inset. Every Step 5
 *  scroll view uses this so no CTA or field ends up under the bottom nav. */
export const TAB_BAR_CLEARANCE = 78;

/** Status tints. Green = machine-verified, amber = a human still has to look,
 *  red = blocked. Never the only signal — each panel also carries an icon and
 *  a written status, for colour-blind users and screen readers. */
export const TONE = {
  ok: '#34D399',
  warn: '#E8B03F',
  bad: '#E5484D',
} as const;

export type Tone = keyof typeof TONE;

/** Screen headline + supporting copy + the small illustration on the right. */
export function Step5Hero({
  title,
  highlight,
  trailing,
  sub,
  art,
  artLabel,
}: {
  /** Rendered as `{title} {highlight} {trailing}`, highlight in brand blue —
   *  so the emphasised word can sit mid-sentence ("Add your bank account"). */
  title: string;
  highlight: string;
  trailing?: string;
  sub: string;
  art: ImageSource;
  artLabel: string;
}) {
  const c = useBrandColors();
  return (
    <View style={styles.hero}>
      <View style={styles.heroText}>
        <Text style={[styles.h1, { color: c.text }]}>
          {title} <Text style={{ color: c.primary }}>{highlight}</Text>
          {trailing ? ` ${trailing}` : ''}
        </Text>
        <Text style={[styles.sub, { color: c.textSecondary }]}>{sub}</Text>
      </View>
      <Image
        source={art}
        style={styles.heroArt}
        contentFit="contain"
        accessibilityIgnoresInvertColors
        accessibilityLabel={artLabel}
      />
    </View>
  );
}

export function Card({
  children,
  tint,
  style,
}: {
  children: React.ReactNode;
  /** Border tint for status cards; defaults to the neutral card border. */
  tint?: string;
  style?: object;
}) {
  const c = useBrandColors();
  return (
    <View
      style={[styles.card, { backgroundColor: c.cardBackground, borderColor: tint ?? c.border }, style]}
    >
      {children}
    </View>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  const c = useBrandColors();
  return <Text style={[styles.cardTitle, { color: c.text }]}>{children}</Text>;
}

/** Label/value row for verified provider data. Renders nothing when the value
 *  is missing — we show what the provider actually returned, never a blank or
 *  a placeholder that could read as fact. */
export function DetailRow({ label, value }: { label: string; value?: string | null }) {
  const c = useBrandColors();
  if (!value) return null;
  return (
    <View style={styles.detailRow} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.detailLabel, { color: c.textSecondary }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: c.text }]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

/** Verified / under-review / blocked panel head. */
export function StatusPanel({
  tone,
  icon,
  title,
  children,
}: {
  tone: Tone;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children?: React.ReactNode;
}) {
  const tint = TONE[tone];
  return (
    <Card tint={`${tint}55`}>
      <View style={styles.statusHead} accessibilityLiveRegion="polite">
        <Ionicons name={icon} size={20} color={tint} />
        <Text style={[styles.statusTitle, { color: tint }]}>{title}</Text>
      </View>
      {children}
    </Card>
  );
}

/** Inline note. `tone` omitted = neutral information. */
export function Note({
  children,
  tone,
  icon,
}: {
  children: React.ReactNode;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const c = useBrandColors();
  const tint = tone ? TONE[tone] : c.primary;
  return (
    <View
      style={[
        styles.note,
        { borderColor: tone ? `${tint}70` : c.border, backgroundColor: c.cardBackground },
      ]}
      accessibilityLiveRegion={tone === 'bad' ? 'assertive' : 'polite'}
    >
      <Ionicons
        name={icon ?? (tone === 'bad' ? 'alert-circle-outline' : 'information-circle-outline')}
        size={16}
        color={tint}
      />
      <Text style={[styles.noteText, { color: tone === 'bad' ? tint : c.textSecondary }]}>
        {children}
      </Text>
    </View>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  const c = useBrandColors();
  return <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>{children}</Text>;
}

export function Hint({ children }: { children: React.ReactNode }) {
  const c = useBrandColors();
  return <Text style={[styles.hint, { color: c.textFaint }]}>{children}</Text>;
}

/** Single-select option row (turnover bands, registration type). */
export function ChoiceRow({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: disabled || !onPress }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.choice,
        {
          borderColor: selected ? c.primary : c.border,
          backgroundColor: selected ? 'rgba(46,107,255,0.12)' : 'transparent',
        },
        pressed && !disabled && { opacity: 0.75 },
      ]}
    >
      <View style={[styles.radio, { borderColor: selected ? c.primary : c.borderStrong }]}>
        {selected && <View style={[styles.radioDot, { backgroundColor: c.primary }]} />}
      </View>
      <Text style={[styles.choiceText, { color: selected ? c.primary : c.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Declaration checkbox. Nothing is ever pre-ticked. */
export function CheckRow({
  text,
  checked,
  onToggle,
}: {
  text: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={text}
      hitSlop={4}
      style={({ pressed }) => [styles.checkRow, pressed && { opacity: 0.75 }]}
    >
      <View
        style={[
          styles.checkBox,
          { borderColor: checked ? c.primary : c.borderStrong },
          checked && { backgroundColor: c.primary },
        ]}
      >
        {checked && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
      </View>
      <Text style={[styles.checkText, { color: c.textSecondary }]}>{text}</Text>
    </Pressable>
  );
}

/** Primary CTA. `busy` shows a spinner and blocks repeat taps — the first
 *  line of defence against paying for a duplicate provider lookup. */
export function PrimaryCta({
  label,
  onPress,
  disabled,
  busy,
  icon = 'arrow-forward',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const blocked = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!blocked, busy: !!busy }}
      style={({ pressed }) => [
        styles.cta,
        { backgroundColor: '#2E6BFF' },
        blocked && { opacity: 0.45 },
        pressed && !blocked && { opacity: 0.85 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <>
          <Text style={styles.ctaText}>{label}</Text>
          <Ionicons name={icon} size={20} color="#FFFFFF" />
        </>
      )}
    </Pressable>
  );
}

/** Secondary, outlined action — "Change tax selection", "Open gst.gov.in". */
export function GhostButton({
  label,
  onPress,
  icon,
  role = 'button',
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  role?: 'button' | 'link';
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.ghost,
        { borderColor: 'rgba(74,143,229,0.55)', opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.ghostText, { color: c.primary }]}>{label}</Text>
      {!!icon && <Ionicons name={icon} size={15} color={c.primary} />}
    </Pressable>
  );
}

export const step5Styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two + Spacing.one,
  },
});

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  heroText: { flex: 1, gap: 5 },
  heroArt: { width: 104, height: 78 },
  h1: { fontSize: 25, fontFamily: Fonts.sansSemiBold, lineHeight: 31 },
  sub: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 19 },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two + Spacing.one },
  cardTitle: { fontSize: 15, fontFamily: Fonts.sansSemiBold },

  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  detailLabel: { width: 104, fontSize: 12.5, fontFamily: Fonts.sans },
  detailValue: { flex: 1, fontSize: 13.5, fontFamily: Fonts.sansMedium },

  statusHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  statusTitle: { flex: 1, fontSize: 14.5, fontFamily: Fonts.sansSemiBold },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two,
  },
  noteText: { flex: 1, fontSize: 12, fontFamily: Fonts.sans, lineHeight: 16.5 },

  fieldLabel: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
  hint: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16 },

  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: 11,
    minHeight: 46,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 9, height: 9, borderRadius: 5 },
  choiceText: { flex: 1, fontSize: 13, fontFamily: Fonts.sansMedium },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one, minHeight: 30 },
  checkBox: {
    width: 19,
    height: 19,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkText: { flex: 1, fontSize: 12, fontFamily: Fonts.sans, lineHeight: 16.5 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 55,
    borderRadius: 16,
    marginTop: Spacing.one,
  },
  ctaText: { color: '#FFFFFF', fontSize: 17, fontFamily: Fonts.sansSemiBold },

  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    minHeight: 44,
  },
  ghostText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
});
