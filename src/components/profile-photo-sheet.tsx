// Bottom action sheet for the avatar's camera button — the only
// profile-photo control in the app. Options are real actions wired by the
// caller; "Remove photo" appears only when a photo actually exists.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

const DANGER = '#E5484D';

function SheetRow({
  icon,
  label,
  destructive = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  const c = useBrandColors();
  const tint = destructive ? DANGER : c.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: 'rgba(120,150,210,0.08)' }]}
    >
      <Ionicons name={icon} size={21} color={destructive ? DANGER : c.primary} />
      <Text style={[styles.rowLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

export function ProfilePhotoSheet({
  visible,
  hasPhoto,
  onTakePhoto,
  onPickFromLibrary,
  onRemove,
  onClose,
}: {
  visible: boolean;
  hasPhoto: boolean;
  onTakePhoto: () => void;
  onPickFromLibrary: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();

  // Close first so the picker/camera opens on a clean screen.
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: c.cardBackground, borderColor: c.border, paddingBottom: insets.bottom + Spacing.two },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: c.border }]} />
        <Text style={[styles.title, { color: c.textSecondary }]}>
          {hasPhoto ? 'Change profile photo' : 'Add profile photo'}
        </Text>
        <SheetRow icon="camera-outline" label="Take photo" onPress={run(onTakePhoto)} />
        <SheetRow icon="images-outline" label="Choose from library" onPress={run(onPickFromLibrary)} />
        {hasPhoto && (
          <SheetRow icon="trash-outline" label="Remove photo" destructive onPress={run(onRemove)} />
        )}
        <View style={[styles.cancelDivider, { backgroundColor: c.border }]} />
        <SheetRow icon="close-outline" label="Cancel" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,5,14,0.6)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: Spacing.two },
  title: {
    fontSize: 12.5,
    fontFamily: Fonts.sansMedium,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginLeft: Spacing.two,
    marginBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: Spacing.two,
    paddingVertical: 14,
    minHeight: 52,
    borderRadius: 12,
  },
  rowLabel: { fontSize: 15.5, fontFamily: Fonts.sansMedium },
  cancelDivider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.one },
});
