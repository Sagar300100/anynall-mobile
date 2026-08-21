// Unboxing video — the buyer-protection client primitive (spec Gap 2).
//
// The complaint endpoint (`POST /api/orders/:id/complaint`) REQUIRES a
// videoPath under `unboxing/{buyerUid}/{orderId}/…` that exists in Storage,
// so this module owns exactly that: record on the device camera (≤3 min),
// upload to the canonical path, hand back the PATH (not a download URL — the
// path is what the endpoint validates). Capture and upload are separate
// exports so the recorder card can retry a failed upload without making the
// buyer re-film the unboxing.
//
// Storage rules for `unboxing/{uid}/{orderId}/{file}` are being added
// backend-side in parallel (owner-write, video content-types, ≤200MB). Until
// they land, uploads fail with storage/unauthorized — which surfaces here as
// the same honest "Couldn’t save the video — try again." copy, never a
// silent failure.
import * as ImagePicker from 'expo-image-picker';
import { ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { Alert, Linking } from 'react-native';

import { auth, storage } from '@/lib/firebase';

/** Server-side contract: complaints accept videos of up to 3 minutes. */
export const UNBOXING_MAX_SECONDS = 180;

/** The canonical Storage path the complaint endpoint validates against. */
export function unboxingStoragePath(uid: string, orderId: string): string {
  return `unboxing/${uid}/${orderId}/video.mp4`;
}

/** Same camera/permission idiom as use-profile-photo: explain and offer the
 *  system settings instead of failing silently. */
function cameraPermissionAlert() {
  Alert.alert(
    'Can’t access your camera',
    'Any&All needs camera permission to record your unboxing video. You can allow it in system settings.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open settings', onPress: () => Linking.openSettings().catch(() => {}) },
    ]
  );
}

/**
 * Open the camera in video mode: ≤3 minutes, medium quality — the video is
 * evidence, it needs to be watchable, and a full-resolution file would upload
 * forever on a mobile connection. Returns the captured asset, or null when
 * the buyer cancelled or camera permission is denied (the settings alert has
 * already been shown in that case).
 */
export async function captureUnboxingVideo(): Promise<ImagePicker.ImagePickerAsset | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    cameraPermissionAlert();
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    videoMaxDuration: UNBOXING_MAX_SECONDS,
    // iOS only; Android records at the device default.
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
  });
  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0];
}

/**
 * Upload a captured video to `unboxing/{uid}/{orderId}/video.mp4` and return
 * that storage path. Progress is reported as a 0..1 fraction.
 *
 * Throws an Error carrying buyer-facing copy on ANY failure — including a
 * permission-denied from Storage rules that haven't been deployed yet — so
 * the UI can show an honest retry state.
 */
export async function uploadUnboxingVideo(
  orderId: string,
  asset: Pick<ImagePicker.ImagePickerAsset, 'uri' | 'mimeType'>,
  onProgress?: (fraction: number) => void
): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('You need to be signed in to save an unboxing video.');
  const path = unboxingStoragePath(uid, orderId);
  try {
    const blob = await (await fetch(asset.uri)).blob();
    const task = uploadBytesResumable(storageRef(storage, path), blob, {
      // iOS camera capture is video/quicktime; the rules gate on video/*.
      contentType: asset.mimeType || 'video/mp4',
    });
    await new Promise<void>((resolve, reject) => {
      task.on(
        'state_changed',
        (snap) => onProgress?.(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
        reject,
        () => resolve()
      );
    });
  } catch {
    // One honest message for every failure mode (network drop, rules not yet
    // deployed → storage/unauthorized, file unreadable). Never silent.
    throw new Error('Couldn’t save the video — try again.');
  }
  return path;
}

/**
 * The one-call primitive: record on the camera, then upload. Resolves with
 * the storage path, or null when the buyer cancelled / denied the camera.
 * Upload failures reject with buyer-facing copy (see uploadUnboxingVideo).
 */
export async function recordUnboxingVideo(
  orderId: string,
  onProgress?: (fraction: number) => void
): Promise<string | null> {
  const asset = await captureUnboxingVideo();
  if (!asset) return null;
  return uploadUnboxingVideo(orderId, asset, onProgress);
}
