import { create } from "zustand";
import { getSetting, setSetting } from "../lib/api/db";
import {
  clearNotifications,
  deleteNotification,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  restoreNotification,
  type NotificationRecord,
} from "../lib/api/notifications";

const CHANNEL_NOTIFICATIONS_KEY = "subscription_notifications";

interface NotificationState {
  notifications: NotificationRecord[];
  unreadCount: number;
  loading: boolean;
  loaded: boolean;

  channelNotifications: Record<string, boolean>;
  channelPrefsLoaded: boolean;

  loadNotifications: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  prependNotifications: (records: NotificationRecord[]) => void;
  markAllRead: () => Promise<void>;
  removeNotification: (id: number) => Promise<void>;
  /** Undoes a removal, in its old place. */
  restoreRemoved: (notification: NotificationRecord) => Promise<void>;
  clearAll: () => Promise<void>;

  loadChannelPreferences: () => Promise<void>;
  isChannelNotificationEnabled: (channelId: string) => boolean;
  setChannelNotification: (channelId: string, enabled: boolean) => Promise<void>;
}

function cleanChannelId(channelId: string) {
  return channelId.replace("channel:", "");
}

async function persistChannelPreferences(prefs: Record<string, boolean>) {
  await setSetting(CHANNEL_NOTIFICATIONS_KEY, JSON.stringify(prefs));
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  loaded: false,
  channelNotifications: {},
  channelPrefsLoaded: false,

  loadNotifications: async () => {
    set({ loading: true });
    try {
      const [notifications, unreadCount] = await Promise.all([
        getNotifications(),
        getUnreadNotificationCount(),
      ]);
      set({ notifications, unreadCount, loading: false, loaded: true });
    } catch (error) {
      console.error("Failed to load notifications", error);
      set({ loading: false, loaded: true });
    }
  },

  refreshUnreadCount: async () => {
    try {
      const unreadCount = await getUnreadNotificationCount();
      set({ unreadCount });
    } catch (error) {
      console.error("Failed to refresh unread notification count", error);
    }
  },

  prependNotifications: (records) => {
    if (records.length === 0) return;
    const { notifications } = get();
    const existingIds = new Set(notifications.map((item) => item.id));
    const fresh = records.filter((record) => !existingIds.has(record.id));
    if (fresh.length === 0) return;
    set({
      notifications: [...fresh, ...notifications],
      unreadCount: get().unreadCount + fresh.filter((record) => !record.isRead).length,
    });
  },

  markAllRead: async () => {
    if (get().unreadCount === 0) return;
    set({
      unreadCount: 0,
      notifications: get().notifications.map((item) => ({ ...item, isRead: true })),
    });
    try {
      await markNotificationsRead();
    } catch (error) {
      console.error("Failed to mark notifications read", error);
      await get().loadNotifications();
    }
  },

  removeNotification: async (id) => {
    const previous = get().notifications;
    const target = previous.find((item) => item.id === id);
    set({
      notifications: previous.filter((item) => item.id !== id),
      unreadCount: target && !target.isRead ? Math.max(0, get().unreadCount - 1) : get().unreadCount,
    });
    try {
      await deleteNotification(id);
    } catch (error) {
      console.error("Failed to delete notification", error);
      set({ notifications: previous });
      await get().refreshUnreadCount();
    }
  },

  restoreRemoved: async (notification) => {
    const previous = get().notifications;
    if (previous.some((item) => item.id === notification.id)) return;
    set({
      notifications: [...previous, notification].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id),
      unreadCount: get().unreadCount + (notification.isRead ? 0 : 1),
    });
    try {
      await restoreNotification(notification);
    } catch (error) {
      console.error("Failed to restore notification", error);
      set({ notifications: previous });
      await get().refreshUnreadCount();
    }
  },

  clearAll: async () => {
    const previous = get().notifications;
    set({ notifications: [], unreadCount: 0 });
    try {
      await clearNotifications();
    } catch (error) {
      console.error("Failed to clear notifications", error);
      set({ notifications: previous });
      await get().refreshUnreadCount();
    }
  },

  loadChannelPreferences: async () => {
    try {
      const json = await getSetting(CHANNEL_NOTIFICATIONS_KEY);
      const prefs = json ? (JSON.parse(json) as Record<string, boolean>) : {};
      set({ channelNotifications: prefs, channelPrefsLoaded: true });
    } catch (error) {
      console.error("Failed to load channel notification preferences", error);
      set({ channelNotifications: {}, channelPrefsLoaded: true });
    }
  },

  isChannelNotificationEnabled: (channelId) => {
    return get().channelNotifications[cleanChannelId(channelId)] !== false;
  },

  setChannelNotification: async (channelId, enabled) => {
    const cleanId = cleanChannelId(channelId);
    const next = { ...get().channelNotifications };
    if (enabled) {
      delete next[cleanId];
    } else {
      next[cleanId] = false;
    }
    set({ channelNotifications: next });
    try {
      await persistChannelPreferences(next);
    } catch (error) {
      console.error("Failed to persist channel notification preference", error);
    }
  },
}));
