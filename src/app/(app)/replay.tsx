// Replay player — watches an ended show's recording INSIDE the app
// (previously "Watch replay" bounced to the browser).
//
// Route: /replay?url=…&title=… — the url is the show's public replay file in
// Firebase Storage. expo-video's native players handle mp4/HLS everywhere;
// hosts recording on the web may produce WebM, which iOS's player refuses —
// so a playback error is expected on some replays there, and the screen
// falls back to the browser (which plays WebM fine) instead of dead-ending.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

export default function ReplayScreen() {
  const c = useBrandColors();
  const { url, title } = useLocalSearchParams<{ url?: string; title?: string }>();
  const [failed, setFailed] = useState(false);

  const player = useVideoPlayer(url ? String(url) : null, (p) => {
    p.play();
  });
  const { status, error } = useEvent(player, 'statusChange', {
    status: player.status,
    error: undefined,
  });

  const showError = failed || status === 'error' || !!error || !url;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: '#000' }]} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.topText}>
          <Text style={styles.topTitle} numberOfLines={1}>
            {title || 'Replay'}
          </Text>
          <Text style={[styles.topSub, { color: c.textFaint }]}>Recorded show</Text>
        </View>
      </View>

      {showError ? (
        <View style={styles.center}>
          <Ionicons name="videocam-off-outline" size={36} color={c.textFaint} />
          <Text style={styles.errTitle}>Couldn’t play this replay here</Text>
          <Text style={[styles.errBody, { color: c.textSecondary }]}>
            Some recordings use a format this device’s player doesn’t support. It will still play
            in your browser.
          </Text>
          {!!url && (
            <Pressable
              onPress={() => WebBrowser.openBrowserAsync(String(url)).catch(() => {})}
              accessibilityRole="button"
              accessibilityLabel="Open the replay in your browser"
              style={({ pressed }) => [
                styles.browserBtn,
                { backgroundColor: c.cta, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Ionicons name="open-outline" size={15} color={c.ctaText} />
              <Text style={[styles.browserBtnText, { color: c.ctaText }]}>Open in browser</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={styles.playerWrap}>
          {status === 'loading' && (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ActivityIndicator color="#FFFFFF" size="large" />
            </View>
          )}
          <VideoView
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls
            fullscreenOptions={{ enable: true }}
            onFirstFrameRender={() => setFailed(false)}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topText: { flex: 1, gap: 1 },
  topTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold, color: '#FFFFFF' },
  topSub: { fontSize: 11.5, fontFamily: Fonts.sans },

  playerWrap: { flex: 1, justifyContent: 'center' },
  video: { width: '100%', aspectRatio: 16 / 9, alignSelf: 'center', maxHeight: '100%' },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  errTitle: { fontSize: 16.5, fontFamily: Fonts.sansSemiBold, color: '#FFFFFF', textAlign: 'center' },
  errBody: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  browserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    minHeight: 44,
    marginTop: Spacing.two,
  },
  browserBtnText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
});
