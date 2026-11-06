import type { VideoSummary } from "../../types/video";

/** The watch page's heading for a file: no channel, no reactions, nothing that names YouTube. */
export function LocalWatchMetadata({ currentVideo }: { currentVideo: VideoSummary }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="select-text text-xl font-bold leading-snug tracking-tight text-chrome-neutral-100">
        {currentVideo.title}
      </h1>
      {currentVideo.channelName && (
        <p className="select-text text-sm text-chrome-neutral-400">{currentVideo.channelName}</p>
      )}
    </div>
  );
}
