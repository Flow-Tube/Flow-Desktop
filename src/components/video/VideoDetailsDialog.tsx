import { DetailRows } from "../ui/DetailRows";
import { InfoDialog } from "../ui/InfoDialog";
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

  return (
    <InfoDialog title={getString("details_metadata")} closeLabel={getString("close")} onClose={onClose}>
      <DetailRows rows={lines.flatMap((line) => (line.value ? [{ ...line, value: line.value }] : []))} />
    </InfoDialog>
  );
}
