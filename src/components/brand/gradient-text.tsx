// GradientText — headline words with the 120° sky→bright ramp, rendered as
// react-native-svg <Text> with a linearGradient fill. (MaskedView is a native
// module this build doesn't ship; SVG text is pure JS-side and uses the same
// loaded fonts.)
//
// SIZING: SVG needs explicit width/height. The robust path chosen here is a
// hidden RN <Text> with identical font metrics laid out in-flow (opacity 0) —
// its onLayout gives the exact box, the SVG then renders at that size on top.
// This survives font fallback, letterSpacing, and any glyph width the
// platform produces, where an estimate (chars × em-width) would drift. Pass
// `width` to skip measurement when the caller already knows it (e.g. a fixed
// rail). Until measurement lands, the hidden text alone holds the layout —
// one frame, no flash of unstyled color.
import { useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Svg, {
  Defs,
  Stop,
  Text as SvgText,
  LinearGradient as SvgLinearGradient,
} from 'react-native-svg';

import { Fonts, HeadlineGradient } from '@/constants/theme';

let gradientTextInstance = 0;

export function GradientText({
  children,
  size,
  fontFamily = Fonts.display,
  colors = HeadlineGradient,
  letterSpacing = size >= 28 ? -1 : -0.5,
  width,
}: {
  children: string;
  size: number;
  fontFamily?: string;
  colors?: readonly [string, string];
  /** Display sizes default to the Archivo-wdth compensation (−1 / −0.5). */
  letterSpacing?: number;
  /** Known width skips the measuring pass. */
  width?: number;
}) {
  // Stable per-mount gradient id — SVG defs are document-global, so two
  // instances sharing "grad" would race on color.
  const [gradId] = useState(() => `gt-${++gradientTextInstance}`);
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);

  const lineHeight = Math.ceil(size * 1.12);
  const box = width ? { width, height: lineHeight } : measured;

  return (
    <View style={{ height: box?.height ?? lineHeight, width: box?.width }}>
      {/* The measurer — invisible but laid out, so the parent flows correctly
          even before onLayout fires. Also the accessible node. */}
      <RNText
        numberOfLines={1}
        allowFontScaling={false}
        onLayout={
          width
            ? undefined
            : (e) => {
                const l = e.nativeEvent.layout;
                // Guard: only update when the box actually changed, so the
                // layout→setState→layout loop terminates immediately.
                setMeasured((prev) =>
                  prev && prev.width === l.width && prev.height === l.height
                    ? prev
                    : { width: Math.ceil(l.width) + 2, height: Math.ceil(l.height) }
                );
              }
        }
        style={{
          fontFamily,
          fontSize: size,
          letterSpacing,
          lineHeight,
          opacity: 0,
          alignSelf: 'flex-start',
        }}
      >
        {children}
      </RNText>
      {box && (
        <Svg
          width={box.width}
          height={box.height}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Defs>
            {/* 120°: mostly horizontal, dipping down — the site's headline ramp. */}
            <SvgLinearGradient id={gradId} x1="0" y1="0.2" x2="1" y2="0.8">
              <Stop offset="0" stopColor={colors[0]} />
              <Stop offset="1" stopColor={colors[1]} />
            </SvgLinearGradient>
          </Defs>
          <SvgText
            fill={`url(#${gradId})`}
            fontFamily={fontFamily}
            fontSize={size}
            letterSpacing={letterSpacing}
            x={0}
            // Baseline ≈ 80% of the line box for these faces — matches the
            // hidden RN text closely enough that the swap is invisible.
            y={box.height * 0.8}
          >
            {children}
          </SvgText>
        </Svg>
      )}
    </View>
  );
}
