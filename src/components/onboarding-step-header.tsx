// Shared chrome for every seller-onboarding step: compact header (back,
// "Seller Hub", settings) + the "<Step name> / Step N of M" progress row with
// a thin segmented bar. Step count and position come from ONBOARDING_STEPS,
// so no screen can drift from the real flow.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { ONBOARDING_STEPS, type StepKey } from '@/lib/seller';

/** Fixed width per stage so the rail can scroll the active one into view. */
const STAGE_WIDTH = 78;
/** Must match `styles.rail` paddingHorizontal — the auto-scroll adds it so a
 *  stage lands flush at the left edge instead of being sliced mid-word. */
const RAIL_PAD = Spacing.two;

/** Full name — used for the "current step" line and screen-reader labels. */
const STEP_TITLES: Record<StepKey, string> = {
  store: 'Store Info',
  tax: 'Tax Details',
  aadhaar: 'Identity',
  pan: 'PAN Details',
  gst: 'Tax Registration',
  bank: 'Bank Details',
  agreement: 'Agreement',
  review: 'Review',
  welcome: 'Done',
};

/** Rail names. Each stage gets a fixed width and its own label area, so
 *  labels can never collide — the rail scrolls instead of compressing. */
const RAIL_LABELS: Record<StepKey, string> = {
  store: 'Store Info',
  tax: 'Tax Details',
  aadhaar: 'Identity',
  pan: 'PAN',
  gst: 'Enrolment',
  bank: 'Bank',
  agreement: 'Agreement',
  review: 'Review',
  welcome: 'Done',
};

export function OnboardingStepHeader({
  step,
  onStepPress,
  children,
}: {
  step: StepKey;
  /** Navigate to an earlier, already-completed step (the circles are the
   *  only way back — there is no separate back button). */
  onStepPress?: (s: StepKey) => void;
  /** Screen headline, rendered between the eyebrow row and the rail. */
  children?: React.ReactNode;
}) {
  const c = useBrandColors();
  const index = ONBOARDING_STEPS.findIndex((s) => s.key === step);
  const total = ONBOARDING_STEPS.length;

  // Keep the active stage on screen without the seller scrolling the rail:
  // park the previous stage flush left so the active one sits second, with
  // the upcoming steps still visible after it.
  const railRef = useRef<ScrollView>(null);
  const railX = Math.max(0, (index - 1) * STAGE_WIDTH + RAIL_PAD);
  useEffect(() => {
    railRef.current?.scrollTo({ x: railX, animated: true });
  }, [railX]);


  return (
    <View>
      <View style={styles.topBar}>
        <Text style={[styles.topTitle, { color: c.text }]}>Seller Hub</Text>
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={6}
          style={({ pressed }) => [styles.settingsBtn, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="settings-outline" size={17} color={c.textSecondary} />
        </Pressable>
      </View>

      <View
        style={styles.progress}
        accessibilityLabel={`Onboarding progress: ${STEP_TITLES[step]}, step ${index + 1} of ${total}`}
      >
        <View style={styles.progressLabels}>
          <Text style={[styles.progressStage, { color: c.primary }]}>BECOME A SELLER</Text>
          <Text style={[styles.progressCount, { color: c.primary }]}>
            Step {index + 1} <Text style={{ color: c.textSecondary }}>of {total}</Text>
          </Text>
        </View>

        {!!children && <View style={styles.heroSlot}>{children}</View>}

        {/* Numbered stages joined by connectors, each with its name beneath.
            Eight labelled milestones exceed a 360dp screen, so the rail
            scrolls and keeps the active step in view. Done steps show a tick,
            the active one is filled, upcoming ones stay outlined. */}
        <ScrollView
          ref={railRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
          // The mount effect can fire before the rail has laid out, which
          // clamps the scroll to 0; re-apply once the real width is known.
          onContentSizeChange={() => railRef.current?.scrollTo({ x: railX, animated: false })}
        >
          {ONBOARDING_STEPS.map((s, i) => {
            const done = i < index;
            const active = i === index;
            const filled = done || active;
            // Completed steps stay editable; upcoming ones can't be skipped into.
            const reachable = done && !!onStepPress;
            return (
              <Pressable
                key={s.key}
                onPress={reachable ? () => onStepPress(s.key) : undefined}
                disabled={!reachable}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: !reachable }}
                accessibilityLabel={`${STEP_TITLES[s.key]}, step ${i + 1} of ${total}${done ? ', completed' : ''}`}
                accessibilityHint={reachable ? 'Go back to this step' : undefined}
                style={({ pressed }) => [styles.stage, pressed && reachable && { opacity: 0.65 }]}
              >
                <View style={styles.stageTop}>
                  <View
                    style={[
                      styles.connector,
                      {
                        backgroundColor:
                          i === 0 ? 'transparent' : done || active ? '#2E6BFF' : 'rgba(120,150,210,0.22)',
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.circle,
                      filled
                        ? { backgroundColor: '#2E6BFF', borderColor: '#2E6BFF' }
                        : { backgroundColor: 'transparent', borderColor: 'rgba(120,150,210,0.35)' },
                    ]}
                  >
                    {done ? (
                      <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                    ) : (
                      <Text style={[styles.circleNum, { color: active ? '#FFFFFF' : c.textSecondary }]}>
                        {i + 1}
                      </Text>
                    )}
                  </View>
                  <View
                    style={[
                      styles.connector,
                      {
                        backgroundColor:
                          i === total - 1 ? 'transparent' : done ? '#2E6BFF' : 'rgba(120,150,210,0.22)',
                      },
                    ]}
                  />
                </View>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.stageLabel,
                    { color: active ? c.primary : done ? c.text : c.textSecondary },
                  ]}
                >
                  {RAIL_LABELS[s.key]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: { paddingBottom: Spacing.two, gap: 7 },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
  },
  progressStage: { fontSize: 12, fontFamily: Fonts.sansSemiBold, letterSpacing: 1.4 },
  progressCount: { fontSize: 13, fontFamily: Fonts.sansSemiBold },
  heroSlot: { paddingHorizontal: Spacing.three, gap: 7, paddingTop: 2 },

  // Fixed-width stages: labels get their own space and never collide. Eight
  // of them exceed a 360dp screen, so the rail scrolls horizontally.
  rail: { paddingHorizontal: Spacing.two },
  stage: { width: STAGE_WIDTH, alignItems: 'center', gap: 5 },
  stageLabel: { fontSize: 11, fontFamily: Fonts.sansMedium, textAlign: 'center', lineHeight: 14 },
  stageTop: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  connector: { flex: 1, height: 2 },
  circle: {
    width: 27,
    height: 27,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleNum: { fontSize: 12.5, fontFamily: Fonts.sansSemiBold },
});
