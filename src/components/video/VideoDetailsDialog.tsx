import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { getString } from "../../lib/i18n/index";
import type { VideoSummary } from "../../types/video";

interface VideoDetailsDialogProps {
  video: VideoSummary;
  title: string;
  durationText: string | null;
  publishedText?: string | null;
  whyShown?: string;
  onClose: () => void;
}

/** What the app knows about a video, ids included. */
export function VideoDetailsDialog({ video, title, durationText, publishedText, whyShown, onClose }: VideoDetailsDialogProps) {
  const lines: { label: string; value: string | null | undefined; mono?: boolean }[] = [
    { label: getString("details_title"), value: title },
    { label: getString("home_feed_why"), value: whyShown },
    { label: getString("details_channel"), value: video.channelName },
    { label: getString("details_views"), value: video.viewCountText },
    { label: getString("details_duration"), value: durationText },
    { label: getString("details_uploaded"), value: publishedText },
    { label: getString("details_video_id"), value: video.id, mono: true },
    { label: getString("details_channel_id"), value: video.channelId, mono: true },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={getString("details_metadata")}
        className="flex max-h-[80vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl border border-chrome-neutral-800 bg-surface-container p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-base font-medium text-chrome-neutral-100">{getString("details_metadata")}</h3>
        <dl className="flex flex-col gap-3 select-text">
          {lines
            .filter((line) => line.value)
            .map((line) => (
              <div key={line.label}>
                <dt className="text-xs font-semibold text-chrome-neutral-500">{line.label}</dt>
                <dd className={`break-words text-sm text-chrome-neutral-100 ${line.mono ? "font-mono" : "tabular-nums"}`}>
                  {line.value}
                </dd>
              </div>
            ))}
        </dl>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {getString("close")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
