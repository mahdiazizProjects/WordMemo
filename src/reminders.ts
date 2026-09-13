import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
const IDENTIFIER = 'wordmemo-daily';
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
}
/** Called only after the person explicitly enables or changes a reminder. */
export async function configureReminder(enabled: boolean, time: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (enabled) throw new Error('Daily notifications are available in the Android and iPhone app.');
    return;
  }
  if (!enabled) { await Notifications.cancelScheduledNotificationAsync(IDENTIFIER); return; }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Use a time such as 08:00 or 19:30.');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('daily', { name: 'Daily Scripture practice', importance: Notifications.AndroidImportance.DEFAULT });
  const allowed = (p: Notifications.NotificationPermissionsStatus) => p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  let permission = await Notifications.getPermissionsAsync();
  if (!allowed(permission)) permission = await Notifications.requestPermissionsAsync();
  if (!allowed(permission)) throw new Error('Notifications are off. You can allow WordMemo notifications in your phone settings.');
  const [hour, minute] = time.split(':').map(Number);
  // A stable ID updates this reminder without duplicating it or cancelling unrelated notifications.
  await Notifications.scheduleNotificationAsync({
    identifier: IDENTIFIER,
    content: { title: 'A moment in the Word', body: 'Your Scripture practice is ready whenever you are.', sound: false },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: 'daily' },
  });
}
