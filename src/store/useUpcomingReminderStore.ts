import { create } from "zustand";
import {
  cancelUpcomingReminder,
  getUpcomingReminders,
  setUpcomingReminder,
} from "../lib/api/notifications";
import { getString } from "../lib/i18n/index";
import { useUiStore } from "./useUiStore";
import type { VideoSummary } from "../types/video";

interface UpcomingReminderState {
  ids: Set<string>;
  loaded: boolean;
  load: () => Promise<void>;
  /** Sets the reminder, or takes it away, at once; the store goes back if the write fails. */
  toggle: (video: VideoSummary, startsAtMs: number) => Promise<void>;
  /** The backend delivered these, so they are no longer pending. */
  forget: (videoIds: string[]) => void;
}

export const useUpcomingReminderStore = create<UpcomingReminderState>((set, get) => ({
  ids: new Set(),
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const reminders = await getUpcomingReminders();
      set({ ids: new Set(reminders.map((reminder) => reminder.videoId)), loaded: true });
    } catch (error) {
      console.warn("Failed to read upcoming reminders", error);
    }
  },
  forget: (videoIds) => {
    if (videoIds.length === 0) return;
    const next = new Set(get().ids);
    videoIds.forEach((id) => next.delete(id));
    set({ ids: next });
  },
  toggle: async (video, startsAtMs) => {
    const previous = get().ids;
    const removing = previous.has(video.id);
    const next = new Set(previous);
    if (removing) next.delete(video.id);
    else next.add(video.id);
    set({ ids: next });
    try {
      if (removing) {
        await cancelUpcomingReminder(video.id);
      } else {
        await setUpcomingReminder({
          videoId: video.id,
          releaseTimeMs: startsAtMs,
          title: video.title,
          channelName: video.channelName,
          channelId: video.channelId ?? null,
          thumbnailUrl: video.thumbnailUrl ?? null,
        });
      }
      useUiStore.getState().showToast({
        message: getString(removing ? "upcoming_reminder_removed" : "upcoming_reminder_enabled"),
      });
    } catch (error) {
      console.error("Failed to update the reminder", error);
      set({ ids: previous });
      useUiStore.getState().showToast({ variant: "error", message: getString("upcoming_reminder_failed") });
    }
  },
}));
