import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  setUpcomingReminder: vi.fn(),
  cancelUpcomingReminder: vi.fn(),
  getUpcomingReminders: vi.fn(),
}));
vi.mock("../lib/api/notifications", () => api);

import { useUpcomingReminderStore } from "./useUpcomingReminderStore";

const video = { id: "v", title: "Premiere", channelName: "Channel" };

describe("upcoming reminders", () => {
  beforeEach(() => {
    useUpcomingReminderStore.setState({ ids: new Set(), loaded: false });
    api.setUpcomingReminder.mockReset().mockResolvedValue(undefined);
    api.cancelUpcomingReminder.mockReset().mockResolvedValue(undefined);
  });

  it("sets then takes away a reminder, at the video's start time", async () => {
    await useUpcomingReminderStore.getState().toggle(video, 1234);
    expect(useUpcomingReminderStore.getState().ids.has("v")).toBe(true);
    expect(api.setUpcomingReminder.mock.calls[0]?.[0]).toMatchObject({ videoId: "v", releaseTimeMs: 1234 });
    await useUpcomingReminderStore.getState().toggle(video, 1234);
    expect(useUpcomingReminderStore.getState().ids.has("v")).toBe(false);
    expect(api.cancelUpcomingReminder).toHaveBeenCalledWith("v");
  });

  it("goes back when the write fails", async () => {
    api.setUpcomingReminder.mockRejectedValue(new Error("disk full"));
    await useUpcomingReminderStore.getState().toggle(video, 1234);
    expect(useUpcomingReminderStore.getState().ids.has("v")).toBe(false);
  });
});
