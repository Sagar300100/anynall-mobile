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
  danger: '#FF6B6B', // aligned to the redesign's auth danger (was #F87171)
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

/**
 * The redesign palette — docs/design-language.md §1, hex-exact from the
 * website's shipped code. ADDITIVE: `Colors` above keeps working for screens
 * not yet swept; new/redesigned surfaces read from `Brand`.
 */
export const Brand = {
  // Stage & surfaces
  stage: '#000000', // landing/hero ground (true black)
  ink950: '#020814', // app page gradient stops
  ink850: '#05122A', // app page gradient mid
  ink800: '#0A1428', // panel
  ink700: '#0E1A36', // card
  ink600: '#11214A', // card hover/selected
  liveRoomBase: '#040B1C', // live room ground (keep existing room styling)

  // Brand blues
  blueBright: '#1E6FFF', // CTA gradient start
  blueSky: '#4DB8FF', // THE accent — links, active, focus, prices
  blueDeep: '#0A4FD0', // app-shell CTA gradient end
  blueGlow: '#4A8FE5', // hairlines, eyebrows, glows
  blueElectric: '#6BB6FF', // italic accents, icons
  logoHighlight: '#4796DA', // ampersand, gradient-text start
  logoMid: '#2467BA', // gradient-text end
  logoCore: '#185AB6', // avatar fills, deep glows
  navyText: '#04122B', // text ON the bright CTA gradient

  // Text on dark (opacity tiers of white)
  text: '#FFFFFF',
  mist: 'rgba(255,255,255,0.72)', // body
  mistSoft: 'rgba(255,255,255,0.55)',
  mistFaint: 'rgba(255,255,255,0.40)',
  slate400: '#9FB4D8', // app secondary text
  slate500: '#8FA8CC', // live-room secondary

  // Semantic
  live: '#E5484D', // in-app LIVE badge (landing uses #E63946)
  liveRose: '#F43F5E', // show-card LIVE tag
  dangerSoft: '#FF8A8A',
  successSoft: '#7BE3A0', // sold/yours/winning
  amberDue: '#FFD79A', // …on amberDueBg
  amberDueBg: 'rgba(255,178,64,0.10)',

  // Auth-surface accents (spec §6.4)
  authAccent: '#2B7FFF',
  authFocusRing: 'rgba(43,127,255,0.20)',
  authDanger: '#FF6B6B',

  // Hairlines
  hairline: 'rgba(74,143,229,0.18)', // blue family (app shell)
  hairlineSoft: 'rgba(74,143,229,0.10)',
  hairlineWhite: 'rgba(255,255,255,0.10)', // neutral family (cards/auth)
} as const;

/** App-shell primary CTA fill — render at 135° (start {0,0} → end {1,1}). */
export const CtaGradientShell = ['#1E6FFF', '#0A4FD0'] as const;
/** In-room CTA fill (bids/buy) — 135°, text Brand.navyText. */
export const CtaGradientRoom = ['#1E6FFF', '#4DB8FF'] as const;
/** Gradient headline text ramp — 120° (see components/brand/gradient-text). */
export const HeadlineGradient = ['#4DB8FF', '#1E6FFF'] as const;
/** Logo ramp text — 96°. */
export const LogoGradient = ['#4796DA', '#2467BA'] as const;

/**
 * Shadow recipes. Apply on the OUTER wrapper (never on an overflow-hidden
 * view, or iOS clips the shadow). Never animate shadow props.
 */
export const Shadows = {
  /** The blue CTA glow: site `0 12px 28px -10px rgba(30,111,255,0.85)`. */
  cta: {
    shadowColor: '#1E6FFF',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
} as const;

// Brand type — loaded in the root layout via @expo-google-fonts.
//
// Redesign faces (design-language §2): display = Archivo 800/700 (site uses
// wdth 122, which static instances lack — compensate with letterSpacing −0.5
// to −1 at display sizes), ui = Plus Jakarta Sans 500/600/700/800, mono =
// JetBrains Mono (eyebrows/numbers). Cormorant + Inter stay loaded for the
// legacy keys so unswept screens render unchanged.
//
// Fallback: if any font fails to load, the root layout proceeds on fontError
// and React Native silently substitutes the system face for unknown families —
// text stays legible, nothing throws.
export const Fonts = {
  display: 'Archivo_800ExtraBold',
  displayMedium: 'Archivo_700Bold',
  ui: 'PlusJakartaSans_500Medium',
  uiMedium: 'PlusJakartaSans_500Medium', // alias — Jakarta's base weight IS "Medium"
  uiSemiBold: 'PlusJakartaSans_600SemiBold',
  uiBold: 'PlusJakartaSans_700Bold',
  uiExtraBold: 'PlusJakartaSans_800ExtraBold', // badge micro / prices
  // Legacy faces (pre-redesign screens still reference these keys).
  serif: 'CormorantGaramond_500Medium',
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
