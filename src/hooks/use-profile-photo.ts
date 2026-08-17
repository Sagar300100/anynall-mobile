// Profile photo: pick/shoot → square crop → resize/compress → upload to
// Firebase Storage (avatars/{uid}/…) → persist on the Firebase Auth user
// record (photoURL) → refresh locally.
//
// Real end-to-end only: the upload targets the project's real bucket (rules
// allow owner-only writes under /avatars/{uid}), and the URL lands on the
// same photoURL field the web app and conversations already read. The
// previous photo stays visible until a replacement upload fully succeeds.
import { updateProfile } from 'firebase/auth';
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { AccessibilityInfo, Alert, Linking } from 'react-native';

import { auth, storage } from '@/lib/firebase';
import { useSession } from '@/lib/session';

/** Longest edge of the stored avatar; uploads stay small and square. */
const AVATAR_SIDE = 800;

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true, // native square-crop UI on both platforms
  aspect: [1, 1],
  quality: 1, // compression happens after the resize below
};

function permissionAlert(what: 'camera' | 'photo library') {
  Alert.alert(
    `Can’t access your ${what}`,
    `Any&All needs ${what} permission to update your profile photo. You can allow it in system settings.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open settings', onPress: () => Linking.openSettings().catch(() => {}) },
    ]
  );
}

/**
 * Square-crop (only if the picker somehow returned a non-square image),
 * downscale to ≤800px and re-encode as JPEG. Rendering through the
 * manipulator also bakes in EXIF rotation, so portrait camera shots
 * arrive upright.
 */
async function processImage(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  const side = Math.min(asset.width, asset.height);
  if (asset.width !== asset.height) {
    ctx.crop({
      originX: Math.floor((asset.width - side) / 2),
      originY: Math.floor((asset.height - side) / 2),
      width: side,
      height: side,
    });
  }
  if (side > AVATAR_SIDE) {
    ctx.resize({ width: AVATAR_SIDE, height: AVATAR_SIDE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({
    format: ImageManipulator.SaveFormat.JPEG,
    compress: 0.8,
  });
  return saved.uri;
}

/** Best-effort delete of a previous avatar object we own. Never throws. */
async function deleteOwnedAvatar(url: string | null) {
  // Google-account photos etc. live outside our bucket — leave those alone.
  if (!url || !url.includes('firebasestorage')) return;
  try {
    await deleteObject(storageRef(storage, url));
  } catch {
    // Already gone or not ours — harmless either way.
  }
}

export function useProfilePhoto() {
  const { user } = useSession();
  // Derived, not seeded into state: the hook can mount while the session is
  // still restoring (user null), so a useState initializer would freeze the
  // avatar at null forever. `override` only exists after an upload/removal in
  // this mount — onAuthStateChanged does not re-fire for profile updates.
  const [override, setOverride] = useState<string | null | undefined>(undefined);
  const photoURL = override === undefined ? (user?.photoURL ?? null) : override;
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function upload(asset: ImagePicker.ImagePickerAsset) {
    const current = auth.currentUser;
    if (!current) return;
      setUploading(true);
      setProgress(0);
      AccessibilityInfo.announceForAccessibility('Uploading profile photo');
      const previousURL = photoURL;
      try {
        const processedUri = await processImage(asset);
        const blob = await (await fetch(processedUri)).blob();
        // Timestamped name: a fresh URL on every replacement, so nothing can
        // serve a stale cached image for the old URL.
        const objectRef = storageRef(storage, `avatars/${current.uid}/avatar-${Date.now()}.jpg`);
        const task = uploadBytesResumable(objectRef, blob, {
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=86400',
        });
        await new Promise<void>((resolve, reject) => {
          task.on(
            'state_changed',
            (snap) => setProgress(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
            reject,
            () => resolve()
          );
        });
        const url = await getDownloadURL(objectRef);
        await updateProfile(current, { photoURL: url });
        setOverride(url);
        void deleteOwnedAvatar(previousURL);
        AccessibilityInfo.announceForAccessibility('Profile photo updated');
      } catch {
        // Previous photo (photoURL state) is untouched — nothing was replaced.
        AccessibilityInfo.announceForAccessibility('Profile photo upload failed');
        Alert.alert('Upload failed', 'Your photo wasn’t changed. Please try again.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retry', onPress: () => void upload(asset) },
        ]);
      } finally {
        setUploading(false);
      }
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      permissionAlert('camera');
      return;
    }
    const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
    if (!result.canceled && result.assets[0]) await upload(result.assets[0]);
  }

  async function pickFromLibrary() {
    // Android 13+ uses the system photo picker (no permission needed); the
    // request is a no-op there and a real prompt on older Android and iOS.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted && perm.canAskAgain === false) {
      permissionAlert('photo library');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    if (!result.canceled && result.assets[0]) await upload(result.assets[0]);
  }

  async function removePhoto() {
    const current = auth.currentUser;
    if (!current || !photoURL) return;
    try {
      await updateProfile(current, { photoURL: null });
      void deleteOwnedAvatar(photoURL);
      setOverride(null);
      AccessibilityInfo.announceForAccessibility('Profile photo removed');
    } catch {
      Alert.alert('Couldn’t remove the photo', 'Please try again in a moment.');
    }
  }

  return { photoURL, uploading, progress, takePhoto, pickFromLibrary, removePhoto };
}
