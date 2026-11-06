import { getString, type StringKey } from "./i18n/index";
import type { NotificationRecord } from "./api/notifications";
import { shortsPlayerDisabledNow } from "./useShortsContent";

const DAY_MS = 86_400_000;
const LAST_WEEK_DAYS = 6;

export type NotificationBucket = "new" | "today" | "yesterday" | "lastWeek" | "earlier";

const ORDER: NotificationBucket[] = ["new", "today", "yesterday", "lastWeek", "earlier"];

export const BUCKET_TITLES: Record<NotificationBucket, StringKey> = {
  new: "notifications_group_new",
  today: "notifications_group_today",
  yesterday: "notifications_group_yesterday",
  lastWeek: "notifications_group_last_week",
  earlier: "notifications_group_earlier",
};

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** How many calendar days back; anything stamped after today still counts as today. */
function daysAgo(timestamp: number, now: number): number {
  return Math.max(0, Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS));
}

function dayBucket(timestamp: number, now: number): NotificationBucket {
  const days = daysAgo(timestamp, now);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return days <= LAST_WEEK_DAYS ? "lastWeek" : "earlier";
}

/** The inbox's sections: everything unread first, then the rest by calendar day. */
export function groupNotifications(notifications: NotificationRecord[], now = Date.now()) {
  const groups = new Map<NotificationBucket, NotificationRecord[]>();
  for (const item of notifications) {
    const bucket = item.isRead ? dayBucket(item.createdAt, now) : "new";
    groups.set(bucket, [...(groups.get(bucket) ?? []), item]);
  }
  return ORDER.flatMap((key) => {
    const items = groups.get(key);
    return items ? [{ key, items }] : [];
  });
}

/** When it arrived, in the form its section reads best. */
export function notificationTimeLabel(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const days = daysAgo(timestamp, now);
  if (days <= 1) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days <= LAST_WEEK_DAYS) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** What a notification is, when it is not simply a new upload. */
export function notificationKindLabel(kind: string): string | null {
  switch (kind) {
    case "UPCOMING_LIVE":
      return getString("notifications_kind_upcoming");
    case "NEW_SHORT":
      return getString("notifications_kind_short");
    default:
      return null;
  }
}

/** Where opening it goes: a Short to the Shorts player unless that's off, anything else to the video. */
export function notificationRoute(notification: Pick<NotificationRecord, "kind" | "videoId">): string {
  return notification.kind === "NEW_SHORT" && !shortsPlayerDisabledNow() ? `/shorts/${notification.videoId}` : `/watch/${notification.videoId}`;
}
