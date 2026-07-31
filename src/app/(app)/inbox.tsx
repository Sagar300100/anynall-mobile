import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Spacing } from '@/constants/theme';

export default function InboxScreen() {
  const c = useBrandColors();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.center}>
        <Ionicons name="chatbubble-ellipses-outline" size={56} color={c.primary} />
        <Text style={[styles.title, { color: c.text }]}>Messages coming soon</Text>
        <Text style={{ color: c.textSecondary, textAlign: 'center', lineHeight: 20 }}>
          Direct messages with sellers are being wired up. Until then, use the
          chat inside a live show.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.two,
  },
  title: { fontSize: 18, fontWeight: '700' },
});
