import { describe, expect, it } from "vitest";
import { groupNotifications, notificationKindLabel, notificationRoute } from "./notificationGrouping";
import type { NotificationRecord } from "./api/notifications";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";

const DAY_MS = 86_400_000;
const now = new Date(2026, 10, 6, 12, 0, 0).getTime();

const record = (id: number, daysAgo: number, isRead = true): NotificationRecord => ({
  id,
  videoId: `v${id}`,
  title: "t",
  channelId: null,
  channelName: "c",
  thumbnailUrl: null,
  publishedText: null,
  kind: "NEW_VIDEO",
  isRead,
  createdAt: now - daysAgo * DAY_MS,
});

describe("groupNotifications", () => {
  it("puts unread first, then Android's day sections", () => {
    const groups = groupNotifications(
      [record(1, 0, false), record(2, 0), record(3, 1), record(4, 6), record(5, 7), record(6, 9, false)],
      now,
    );
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ["new", [1, 6]],
      ["today", [2]],
      ["yesterday", [3]],
      ["lastWeek", [4]],
      ["earlier", [5]],
    ]);
  });

  it("leaves out empty sections", () => {
    expect(groupNotifications([record(1, 0)], now).map((g) => g.key)).toEqual(["today"]);
  });
});

describe("notification kinds", () => {
  it("names only what is not a plain upload", () => {
    expect(notificationKindLabel("NEW_VIDEO")).toBeNull();
    expect(notificationKindLabel("UPCOMING_LIVE")).toBe("Now live");
    expect(notificationKindLabel("NEW_SHORT")).toBe("Short");
  });

  it("opens a Short in the Shorts player", () => {
    expect(notificationRoute({ kind: "NEW_SHORT", videoId: "s" })).toBe("/shorts/s");
    useAppSettingsStore.setState({ values: { [SETTINGS.SHORTS_CONTENT_ENABLED]: "false" } });
    expect(notificationRoute({ kind: "NEW_SHORT", videoId: "s" })).toBe("/watch/s");
    useAppSettingsStore.setState({ values: {} });
    expect(notificationRoute({ kind: "UPCOMING_LIVE", videoId: "v" })).toBe("/watch/v");
  });
});
