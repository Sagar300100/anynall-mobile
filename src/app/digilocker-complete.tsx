// Landing route for the DigiLocker redirect
// (anynallmobile://digilocker-complete?session_id=…).
//
// DigiLocker returns the seller here after consent. Nothing is verified on
// this screen — it stores the session id and bounces to the Sell tab, where
// the Identity step asks the backend what actually happened. Returning here
// never means "verified".
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

const SESSION_KEY = 'anynall:digilocker-session';
// 'seller' (wizard) or 'buyer' (Verified-buyer screen) — set by whichever
// journey opened DigiLocker, so this landing route returns to the right one.
const ORIGIN_KEY = 'anynall:digilocker-origin';

export default function DigiLockerComplete() {
  const c = useBrandColors();
  const { session_id: sessionId } = useLocalSearchParams<{ session_id?: string }>();

  useEffect(() => {
    (async () => {
      // Keep whichever id we have: the one DigiLocker echoed back, or the one
      // stored when the journey started.
      if (sessionId) await AsyncStorage.setItem(SESSION_KEY, String(sessionId));
      const origin = await AsyncStorage.getItem(ORIGIN_KEY);
      if (origin === 'buyer') {
        router.replace('/account/verify-identity');
        return;
      }
      // `resume` skips the Seller Hub intro — the seller is mid-application,
      // not deciding whether to start one.
      router.replace({ pathname: '/sell', params: { resume: '1' } });
    })();
  }, [sessionId]);

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <ActivityIndicator color={c.primary} />
      <Text style={[styles.text, { color: c.textSecondary }]}>Checking your verification…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  text: { fontSize: 14, fontFamily: Fonts.sans },
});
