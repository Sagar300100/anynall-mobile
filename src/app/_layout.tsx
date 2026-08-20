// Per-weight subpath imports: the package barrels eagerly require all ten
// weights, and Metro fails resolving ones we don't use.
import { CormorantGaramond_500Medium } from '@expo-google-fonts/cormorant-garamond/500Medium';
import { CormorantGaramond_500Medium_Italic } from '@expo-google-fonts/cormorant-garamond/500Medium_Italic';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { registerGlobals, setLogLevel } from '@livekit/react-native';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { LogBox, Pressable, ScrollView, Text, View } from 'react-native';

import { SplashGate } from '@/components/splash-gate';
import { Colors } from '@/constants/theme';
import { PolicyGate } from '@/components/policy-gate';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

// LiveKit needs WebRTC's globals (RTCPeerConnection, mediaDevices, …) on the
// JS global object before any room is created. Module scope in the root layout
// is the earliest point that runs on every entry into the app.
//
// This is a NATIVE module: it exists only in a dev/production build, never in
// Expo Go. If this line ever throws "WebRTC native module not found", the APK
// predates the LiveKit install — rebuild and reinstall rather than chasing it
// in JS. (Verified present on-device: NativeModules.WebRTCModule resolves and
// the app runs bridgeless.)
registerGlobals();

// Give AbortSignal a `reason`, because React Native's polyfill does not.
//
// The `abort-controller` shim RN ships implements AbortSignal with an aborted
// FLAG and nothing else — `signal.reason` is permanently undefined. Meanwhile
// livekit-client's getAbortReasonAsString does:
//
//     switch (typeof reason) {
//       case 'string': …
//       case 'object': …
//       default: return 'toString' in reason ? …   // undefined lands HERE
//     }
//
// so every aborted signal inside the SDK throws "right operand of 'in' is not
// an object" instead of producing a message. On the web `reason` is a
// DOMException and the branch is never reached, which is why this is invisible
// outside React Native.
//
// Returning a real Error steers the SDK into its `case 'object'` branch and it
// reports "Aborted" as intended. Defined only when absent, so a runtime with a
// proper implementation keeps its own.
// Two livekit-client teardown races that cannot be fixed from here.
//
// Room.recreateEngine() (livekit-client.esm.mjs:32926) sets `this.engine =
// undefined` and only THEN closes the signal socket asynchronously. A signal
// response arriving in that window reaches createParticipant(), which reads
// `this.engine.client` and throws. The same shape produces the SDP-munging
// "Cannot read property 'receiver' of undefined". Both windows are INSIDE the
// library, between nulling the engine and closing the socket, so no ordering
// on our side can close them.
//
// Both are non-fatal: the room is already being disposed and video is
// unaffected — verified on device, playback continued through every one.
//
// This suppression is dev-only cosmetics either way (LogBox does not exist in
// a release build). Matched on the EXACT messages so a genuinely new error
// still surfaces, and it should be removed when livekit-client fixes this.
// The third is the same teardown, one layer down: livekit's signal WebSocket
// fires an "error" event as it closes and the SDK rejects with the raw Event
// rather than an Error. Matched on the livekit signal URL inside the payload,
// NOT on "Event {", so an unrelated rejection is still reported.
// The last two are livekit-client's RESUME path: after a connection blip it
// tries to resume the session, the resumed connection presents a fresh DTLS
// certificate, the server refuses it ("Local fingerprint does not match
// identity"), and the SDK then falls back to a full reconnect — which
// SUCCEEDS. Verified on device: video continued through every occurrence.
// The errors are the library narrating its own recovery.
LogBox.ignoreLogs([
  /Cannot read property 'client' of undefined/,
  /Cannot read property 'receiver' of undefined/,
  /livekit\.cloud\/rtc/,
  /Local fingerprint does not match identity/,
  /unable to set offer/,
  // Same teardown family: the SDK processes a queued signal message after its
  // peer-connection manager was closed and rejects mid-negotiate. The room is
  // already being disposed; playback is unaffected.
  /PC manager is closed/,
]);

if (typeof AbortSignal !== 'undefined' && !('reason' in AbortSignal.prototype)) {
  const aborted = new Error('Aborted');
  Object.defineProperty(AbortSignal.prototype, 'reason', {
    configurable: true,
    get: () => aborted,
  });
}

// LiveKit logs at info by default, which is why the console filled with things
// like `published data channel "LOSSY"` — that is the SDK reporting that it
// opened its two internal data channels (_lossy for droppable messages,
// _reliable for ordered ones). It means the room connected; it is not an error.
// Warn-and-above keeps genuine problems visible without the running commentary,
// and every suppressed line is one fewer hop across the JS bridge.
setLogLevel('warn');

// Warm the App Check debug-token exchange at launch. It is a full network
// round trip (measured at ~2.2s cold on device) and the result is cached, so
// paying it here — while the splash is up and nobody is waiting — takes it off
// the first real request. Joining a live show used to eat it.
// Fire-and-forget: a failure here just means the next call fetches it as before.
import('./../lib/firebase')
  .then((m) => m.getAppCheckHeader())
  .catch(() => {});

// Readable in-app crash screen (expo-router picks this export up) — replaces
// Expo Go's generic "Something went wrong" with the actual error + stack so
// device-only failures are diagnosable without adb.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  console.warn('[boot] fatal error:', error?.message, error?.stack);
  return (
    <View style={{ flex: 1, backgroundColor: '#050A18', padding: 24, paddingTop: 80 }}>
      <Text style={{ color: '#F87171', fontSize: 18, fontWeight: '700' }}>App error</Text>
      <ScrollView style={{ marginVertical: 16 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 14 }}>{String(error?.message || error)}</Text>
        <Text style={{ color: '#9FB4D8', fontSize: 11, marginTop: 12 }}>{error?.stack || ''}</Text>
      </ScrollView>
      <Pressable
        onPress={retry}
        style={{ backgroundColor: '#FFFFFF', borderRadius: 8, padding: 14, alignItems: 'center' }}
      >
        <Text style={{ color: '#0B1F3F', fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { isLoading } = useSession();
  // Failsafe: never wait on init more than a few seconds. A stuck font or auth
  // listener must degrade to system fonts / signed-out UI, not a hang.
  const [forceReady, setForceReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      console.warn('[boot] failsafe fired — fontsLoaded:', fontsLoaded, 'sessionLoading:', isLoading);
      setForceReady(true);
    }, 5000);
    return () => clearTimeout(t);
  }, [fontsLoaded, isLoading]);

  // Ready = fonts loaded AND the persisted session resolved, so the guard below
  // already knows the destination before anything is revealed.
  const ready = (fontsLoaded && !isLoading) || forceReady;

  // The navigator is ALWAYS mounted — expo-router requires a navigator to
  // exist in the root layout from the first render, so gating it behind
  // `ready` leaves the router with nothing to navigate into.
  //
  // Flash prevention is handled by SplashGate instead: it covers the screen
  // opaquely until `ready`, so whatever the guards resolve to underneath is
  // never seen until the destination is settled.
  return (
    <>
      <AppStack />
      {/* Mandatory policy acceptance — renders only for signed-in users who
          haven't accepted Terms/Privacy/Refund yet. Above the stack, below
          the splash, so it can never flash mid-boot. */}
      <PolicyGate />
      <SplashGate ready={ready} />
    </>
  );
}

/**
 * Navigation tree. The app is browsable signed-out — Firestore grants public
 * read on shows/products/auctions, so guests land in the tab group and see
 * real content. Auth is not a wall here: it's requested per action via
 * lib/auth-gate, and the auth screens are pushed on top of wherever the user
 * was, so dismissing returns them to their place.
 */
function AppStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(app)" />
      <Stack.Screen name="sign-in" options={{ presentation: 'card' }} />
      <Stack.Screen name="sign-up" options={{ presentation: 'card' }} />
      <Stack.Screen name="forgot-password" options={{ presentation: 'card' }} />
      <Stack.Screen name="claim-username" options={{ presentation: 'card' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    CormorantGaramond_500Medium,
    CormorantGaramond_500Medium_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_500Medium,
  });
  useEffect(() => {
    if (fontError) console.warn('[boot] font load failed, using system fonts:', fontError.message);
  }, [fontError]);

  // The site is dark-only navy (brand-v2); the app matches regardless of
  // system scheme.
  const c = Colors.dark;
  const navTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: c.primary,
      background: c.background,
      card: c.backgroundElement,
      text: c.text,
      border: c.border,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style="light" />
      <SessionProvider>
        <RootNavigator fontsLoaded={fontsLoaded || !!fontError} />
      </SessionProvider>
    </ThemeProvider>
  );
}
