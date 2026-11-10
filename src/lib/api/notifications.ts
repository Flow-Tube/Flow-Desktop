import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriEnv } from "./env";
import { invokeBackend } from "./errors";

export interface NotificationRecord {
  id: number;
  videoId: string;
  title: string;
  channelId: string | null;
  channelName: string;
  thumbnailUrl: string | null;
  publishedText: string | null;
  kind: string;
  isRead: boolean;
  /** Unix epoch milliseconds. */
  createdAt: number;
}

/** Event name emitted by the Rust poll worker when new notifications land. */
const NEW_NOTIFICATIONS_EVENT = "notifications://new";
/** Emitted with a video id when the user clicks a native system toast. */
const ACTIVATE_NOTIFICATION_EVENT = "notifications://activate";

export async function getNotifications(limit = 200): Promise<NotificationRecord[]> {
  if (!(await isTauriEnv())) return [];
  return invokeBackend<NotificationRecord[]>("get_notifications", { limit });
}

export async function getUnreadNotificationCount(): Promise<number> {
  if (!(await isTauriEnv())) return 0;
  return invokeBackend<number>("get_unread_notification_count");
}

export async function markNotificationsRead(): Promise<void> {
  if (!(await isTauriEnv())) return;
  return invokeBackend<void>("mark_notifications_read");
}

export async function deleteNotification(id: number): Promise<void> {
  if (!(await isTauriEnv())) return;
  return invokeBackend<void>("delete_notification", { id });
}

/** Puts a removed notification back, for Undo. */
export async function restoreNotification(notification: NotificationRecord): Promise<void> {
  if (!(await isTauriEnv())) return;
  return invokeBackend<void>("restore_notification", { notification });
}

/** "Remind me" on an upcoming video; lands in the inbox when the video starts. */
export interface UpcomingReminder {
  videoId: string;
  releaseTimeMs: number;
  title: string;
  channelName: string;
  channelId: string | null;
  thumbnailUrl: string | null;
}

export async function getUpcomingReminders(): Promise<UpcomingReminder[]> {
  if (!(await isTauriEnv())) return [];
  return invokeBackend<UpcomingReminder[]>("get_upcoming_reminders");
}

export async function setUpcomingReminder(reminder: UpcomingReminder): Promise<void> {
  if (!(await isTauriEnv())) return;
  return invokeBackend<void>("set_upcoming_reminder", { reminder });
}

export async function cancelUpcomingReminder(videoId: string): Promise<void> {
  if (!(await isTauriEnv())) return;
  return invokeBackend<void>("cancel_upcoming_reminder", { videoId });
}

export async function clearNotifications(): Promise<void> {
  if (!(await isTauriEnv())) return;
  return invokeBackend<void>("clear_notifications");
}

/** Manually triggers a subscription check; resolves with the count created. */
export async function checkSubscriptionsNow(): Promise<number> {
  if (!(await isTauriEnv())) return 0;
  return invokeBackend<number>("check_subscriptions_now");
}


export async function onNewNotifications(
  callback: (notifications: NotificationRecord[]) => void,
): Promise<UnlistenFn> {
  if (!(await isTauriEnv())) return () => {};
  return listen<NotificationRecord[]>(NEW_NOTIFICATIONS_EVENT, (event) => {
    callback(event.payload ?? []);
  });
}

/** Fires when the user clicks a native system toast; payload is the video id. */
export async function onNotificationActivated(
  callback: (videoId: string) => void,
): Promise<UnlistenFn> {
  if (!(await isTauriEnv())) return () => {};
  return listen<string>(ACTIVATE_NOTIFICATION_EVENT, (event) => {
    if (event.payload) callback(event.payload);
  });
}
