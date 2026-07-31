/**
 * Any & All mobile theme — mirrors the website's brand-v2 system
 * (styles/brand.css + BuyerHomePage): premium dark navy + royal blue,
 * serif display type, mono eyebrows. The site is dark-only, so both
 * schemes resolve to the navy palette.
 */

import '@/global.css';

import { Platform } from 'react-native';

const navy = {
  text: '#FFFFFF',
  background: '#050A18', // --bg-base
  backgroundElement: '#0A1428', // --bg-panel
  backgroundSelected: '#11214A', // --bg-card-hover
  textSecondary: '#9FB4D8', // buyer-home muted blue-grey
  textFaint: 'rgba(255,255,255,0.40)', // --mist-faint
  primary: '#4DB8FF', // electric blue accent (#4db8ff / --blue-glow family)
  blue: '#2B6CB8', // --blue
  blueElectric: '#6BB6FF', // --blue-electric (italic em glow)
  cta: '#FFFFFF', // site's btn-primary is white with navy text
  ctaText: '#0B1F3F', // --navy
  danger: '#F87171',
  live: '#E63946', // --live-red, LIVE indicators ONLY
  border: 'rgba(74,143,229,0.18)', // --hairline
  borderStrong: 'rgba(74,143,229,0.32)', // --hairline-strong
  cardBackground: '#0E1A36', // --bg-card
} as const;

export const Colors = {
  light: navy,
  dark: navy,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// Brand type — loaded in the root layout via @expo-google-fonts.
// display = Cormorant Garamond (site fallback for PP Editorial New),
// body = Inter (fallback for Söhne), mono = JetBrains Mono.
export const Fonts = {
  display: 'CormorantGaramond_500Medium',
  displayItalic: 'CormorantGaramond_500Medium_Italic',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  mono: 'JetBrainsMono_500Medium',
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
