import { useEffect } from "react";

import { useLocalMediaStore } from "../../store/useLocalMediaStore";
import type { VideoSummary } from "../../types/video";
import { LocalFileMenuButton } from "./LocalFileMenuButton";

/** The watch page's heading for a file: no channel, no reactions, nothing that names YouTube. */
export function LocalWatchMetadata({ currentVideo }: { currentVideo: VideoSummary }) {
  const loaded = useLocalMediaStore((s) => s.loaded);
  const load = useLocalMediaStore((s) => s.load);
  const file = useLocalMediaStore((s) => s.files.find((item) => item.id === currentVideo.id));

  // The file's menu needs its row, and a tab restored on this page never opened the library.
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 dir="auto" className="select-text text-xl font-bold leading-snug tracking-tight text-chrome-neutral-100">
          {currentVideo.title}
        </h1>
        {currentVideo.channelName && (
          <p dir="auto" className="select-text text-sm text-chrome-neutral-400">{currentVideo.channelName}</p>
        )}
      </div>
      {file && <LocalFileMenuButton file={file} />}
    </div>
  );
}
