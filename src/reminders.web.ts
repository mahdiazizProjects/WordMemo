/** Web builds do not load the native notification module. */
export async function configureReminder(enabled: boolean, _time: string): Promise<void> {
  if (enabled) throw new Error('Daily notifications are available in the Android and iPhone app.');
}
