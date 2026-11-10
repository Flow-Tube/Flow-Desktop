import { useEffect } from "react";
import { Bell, BellRing } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUpcomingReminderStore } from "../../store/useUpcomingReminderStore";
import type { VideoSummary } from "../../types/video";

interface UpcomingReminderButtonProps {
  video: VideoSummary;
  startsAtMs: number;
}

/** The button for whatever video the player has. */
export function CurrentVideoReminderButton({ startsAtMs }: { startsAtMs: number }) {
  const video = usePlayerStore((state) => state.currentVideo);
  return video ? <UpcomingReminderButton video={video} startsAtMs={startsAtMs} /> : null;
}

/** Remind me, under the countdown of a premiere or stream that has not started. */
export function UpcomingReminderButton({ video, startsAtMs }: UpcomingReminderButtonProps) {
  const reminded = useUpcomingReminderStore((state) => state.ids.has(video.id));
  const load = useUpcomingReminderStore((state) => state.load);
  const toggle = useUpcomingReminderStore((state) => state.toggle);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <button
      type="button"
      aria-pressed={reminded}
      onClick={() => void toggle(video, startsAtMs)}
      className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-surface-container-high px-4 text-sm font-medium text-chrome-neutral-100 transition-colors duration-200 ease-out hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {reminded ? <BellRing size={16} /> : <Bell size={16} />}
      {getString(reminded ? "upcoming_reminder_enabled" : "upcoming_reminder_action")}
    </button>
  );
}
