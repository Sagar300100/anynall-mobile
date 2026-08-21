// src/lib/reminders.ts — LOCAL show reminders via expo-notifications.
//
// This makes "Remind me" real without any server: the reminder is a local
// scheduled notification on this device, firing shortly before the show's
// scheduled time. It is deliberately device-local — there is no push backend
// yet (no sender, no token store the rules would accept), and a local alarm
// is the honest version of this feature: it works in airplane mode and
// promises nothing a server would have to keep.
//
// The showId → notification mapping lives in AsyncStorage so the Remind-me
// button can show its real state and the Notifications screen can list and
// cancel upcoming reminders. Entries for shows already started are pruned on
// every read.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const STORE_KEY = 'anynall:show-reminders';
/** Fire this many minutes before the show starts. */
const LEAD_MINUTES = 10;

export interface ShowReminder {
  showId: string;
  notificationId: string;
  title: string;
  /** The show's scheduled instant (ISO). */
  showAtIso: string;
  /** When the notification actually fires (ISO). */
  fireAtIso: string;
}

// Foreground behaviour (banner even while the app is open, WITH sound for
// reminders) is owned by the single global handler in lib/push-routing.ts —
// expo-notifications keeps exactly one handler, and setting a second one here
// would silently override the remote-push rules (pushes are banner-only in
// the foreground; reminders keep their sound, keyed off data.type).

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('show-reminders', {
    name: 'Show reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4DB8FF',
  });
}

/** Ask for permission (no-op if already granted). Returns whether we may notify. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  if (!settings.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

async function readMap(): Promise<Record<string, ShowReminder>> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ShowReminder>) : {};
  } catch {
    return {};
  }
}

async function writeMap(map: Record<string, ShowReminder>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* storage full/unavailable — the OS alarm still fires */
  }
}

/** Drop entries whose show time has passed. Returns the pruned map. */
async function prunedMap(): Promise<Record<string, ShowReminder>> {
  const map = await readMap();
  const now = Date.now();
  let changed = false;
  for (const [id, r] of Object.entries(map)) {
    if (new Date(r.showAtIso).getTime() <= now) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) await writeMap(map);
  return map;
}

/** Is a reminder currently set for this show? */
export async function isReminderSet(showId: string): Promise<boolean> {
  const map = await prunedMap();
  return !!map[String(showId)];
}

/** All upcoming reminders, soonest first — the Notifications screen's list. */
export async function listReminders(): Promise<ShowReminder[]> {
  const map = await prunedMap();
  return Object.values(map).sort(
    (a, b) => new Date(a.showAtIso).getTime() - new Date(b.showAtIso).getTime()
  );
}

/**
 * Schedule a reminder for a show. Fires LEAD_MINUTES before the scheduled
 * time (or in one minute, if the show is nearer than that — never in the
 * past). Throws 'PERMISSION_DENIED' when notifications are blocked, so the
 * caller can point at system settings instead of failing silently.
 */
export async function scheduleShowReminder(p: {
  showId: string | number;
  title: string;
  scheduledTimeIso: string;
}): Promise<ShowReminder> {
  const granted = await ensureNotificationPermission();
  if (!granted) throw new Error('PERMISSION_DENIED');
  await ensureChannel();

  const showAt = new Date(p.scheduledTimeIso).getTime();
  if (!Number.isFinite(showAt)) throw new Error('BAD_TIME');
  const lead = showAt - LEAD_MINUTES * 60_000;
  const fireAt = new Date(Math.max(lead, Date.now() + 60_000));
  if (fireAt.getTime() >= showAt) throw new Error('TOO_LATE');

  const showId = String(p.showId);
  // One reminder per show — replace, never stack.
  await cancelShowReminder(showId);

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: `${p.title} is starting soon`,
      body: `Live in ${LEAD_MINUTES} minutes on Any&All — get in before the first lot.`,
      sound: true,
      data: { showId },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: Platform.OS === 'android' ? 'show-reminders' : undefined,
    },
  });

  const reminder: ShowReminder = {
    showId,
    notificationId,
    title: p.title,
    showAtIso: new Date(showAt).toISOString(),
    fireAtIso: fireAt.toISOString(),
  };
  const map = await readMap();
  map[showId] = reminder;
  await writeMap(map);
  return reminder;
}

/** Cancel the reminder for a show. Idempotent. */
export async function cancelShowReminder(showId: string | number): Promise<void> {
  const id = String(showId);
  const map = await readMap();
  const existing = map[id];
  if (existing) {
    await Notifications.cancelScheduledNotificationAsync(existing.notificationId).catch(() => {});
    delete map[id];
    await writeMap(map);
  }
}
