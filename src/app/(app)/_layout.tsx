import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';

// Dark-only brand (matches the site); no scheme switch.
const c = Colors.dark;

/**
 * Five destinations, Live first — `index` IS Live, so a cold start (and any
 * guest arriving from the splash) lands there without a redirect.
 *
 * Outline icons throughout; the only colour in the bar is the selected tint,
 * so the active destination is unambiguous without decoration.
 */
function tabIcon(name: keyof typeof Ionicons.glyphMap) {
  function TabIcon({ color }: { color: import('react-native').ColorValue; size: number }) {
    return <Ionicons name={name} size={23} color={color} />;
  }
  return TabIcon;
}

export default function AppTabsLayout() {
  // Measured inset, not a guessed constant — this is what keeps the bar clear
  // of Android's 3-button navigation and the iOS home indicator alike.
  const insets = useSafeAreaInsets();
  const barHeight = 58 + insets.bottom;

  return (
    <Tabs
      // Every pushed screen below (Seller Tools, Inventory, Settings, the show
      // room…) is registered as a Tabs.Screen with `href: null`, so opening one
      // SWITCHES TAB rather than pushing a stack frame. Bottom tabs default to
      // backBehavior "firstRoute", and the first route here is `index` — which
      // is why Back from Seller Tools jumped to Live instead of returning to
      // Seller Hub. "history" returns to the last visited route, so Back
      // retraces the way the seller actually came.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: 'rgba(159,180,216,0.62)',
        tabBarStyle: {
          backgroundColor: c.background,
          borderTopColor: 'rgba(74,143,229,0.14)',
          borderTopWidth: 1,
          height: barHeight,
          paddingTop: 7,
          paddingBottom: insets.bottom + 6,
        },
        // NATIVE font here, deliberately — not Inter. Fabric measures tab
        // labels on a background thread that can't see runtime-loaded fonts,
        // so an Inter label gets a box sized for the system font and paints
        // wider → "Profi…" (verified via uiautomator bounds: "Live" boxed at
        // 36px, painted wider). At 10.5px the system medium face is visually
        // interchangeable; measurement is always correct.
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontFamily: Platform.select({ android: 'sans-serif-medium', ios: 'System' }),
          fontWeight: '500',
          marginTop: 1,
        },
        // All five labels must always render in full — at huge system font
        // sizes the labels would clip, so the bar opts out of font scaling
        // (body text everywhere else still scales normally).
        tabBarAllowFontScaling: false,
      }}
      // Light tick on selection — expo-haptics is already a dependency.
      screenListeners={{
        tabPress: () => {
          Haptics.selectionAsync().catch(() => {});
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Live',
          tabBarAccessibilityLabel: 'Live shows',
          tabBarIcon: tabIcon('radio-outline'),
        }}
      />
      <Tabs.Screen
        name="browse"
        options={{
          title: 'Search',
          tabBarAccessibilityLabel: 'Search',
          tabBarIcon: tabIcon('search-outline'),
        }}
      />
      <Tabs.Screen
        name="sell"
        options={{
          title: 'Sell',
          tabBarAccessibilityLabel: 'Seller Hub',
          tabBarIcon: tabIcon('storefront-outline'),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarAccessibilityLabel: 'Inbox',
          tabBarIcon: tabIcon('chatbubble-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarAccessibilityLabel: 'Profile',
          tabBarIcon: tabIcon('person-outline'),
        }}
      />

      {/* Pushed screens — reachable, but never destinations in the bar. */}
      <Tabs.Screen name="show/[id]" options={{ href: null }} />
      <Tabs.Screen name="live/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="chat/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="orders" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="categories" options={{ href: null }} />
      <Tabs.Screen name="seller-tools" options={{ href: null }} />
      <Tabs.Screen name="inventory" options={{ href: null }} />
      <Tabs.Screen name="product-new" options={{ href: null }} />
      <Tabs.Screen name="seller-tool/[slug]" options={{ href: null }} />
      <Tabs.Screen name="show-room/[id]" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="show-new" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="welcome" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
  );
}
