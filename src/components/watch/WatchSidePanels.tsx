import { createPortal } from "react-dom";
import { useEffect } from "react";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useFullscreenPanelHost } from "../../lib/fullscreenPanelHost";
import { useLingeringValue } from "../../lib/useLingeringValue";
import { motionMs } from "../../lib/motion";
import { seekToTime } from "../../lib/playerSeek";
import { Chapters } from "../player/chapters";
import { QueuePanel } from "../player/QueuePanel";
import { LiveChat } from "./LiveChat";
import type { VideoChapter } from "../../types/video";

const SIDEBAR_PANEL = "h-[min(720px,calc(100vh-140px))] min-h-[450px] w-full shrink-0";

interface WatchSidePanelsProps {
  videoId: string;
  /** Set when the video has a live chat or a chat replay to show. */
  chat: { isReplay: boolean } | null;
  chapters: VideoChapter[];
  autoChapters: boolean;
  videoThumbnail?: string;
}

/*
  Live chat, the queue and chapters with the transcript. In the sidebar as before; in
  fullscreen, whichever one was opened there moves into the panel beside the video,
  and stays drawn while that panel slides shut.
*/
export function WatchSidePanels({ videoId, chat, chapters, autoChapters, videoThumbnail }: WatchSidePanelsProps) {
  const isFullscreen = usePlayerStore((s) => s.isVideoFullscreen);
  const fullscreenPanel = usePlayerStore((s) => s.fullscreenPanel);
  const setFullscreenPanel = usePlayerStore((s) => s.setFullscreenPanel);
  const isChaptersPanelOpen = usePlayerStore((s) => s.isChaptersPanelOpen);
  const setIsChaptersPanelOpen = usePlayerStore((s) => s.setIsChaptersPanelOpen);
  const isQueuePanelOpen = usePlayerStore((s) => s.isQueuePanelOpen);
  const setIsLiveChatAvailable = usePlayerStore((s) => s.setIsLiveChatAvailable);
  const captions = usePlayerStore((s) => s.captions);
  const host = useFullscreenPanelHost();
  const shownPanel = useLingeringValue(isFullscreen ? fullscreenPanel : null, motionMs("--motion-panel"));

  const chatAvailable = chat !== null;
  useEffect(() => {
    setIsLiveChatAvailable(chatAvailable);
    return () => setIsLiveChatAvailable(false);
  }, [chatAvailable, setIsLiveChatAvailable]);

  const chaptersPanel = (
    <Chapters
      chapters={chapters}
      autoChapters={autoChapters}
      captions={captions}
      videoId={videoId}
      onClose={() => setIsChaptersPanelOpen(false)}
      videoThumbnail={videoThumbnail}
      seekTo={seekToTime}
    />
  );

  if (isFullscreen && host) {
    const content =
      shownPanel === "chapters" ? chaptersPanel
      : shownPanel === "queue" ? <QueuePanel />
      : shownPanel === "chat" && chat ? (
        <LiveChat videoId={videoId} isReplay={chat.isReplay} fill onClose={() => setFullscreenPanel(null)} />
      )
      : null;
    return content ? createPortal(<div className="h-full">{content}</div>, host) : null;
  }

  return (
    <>
      {chat && <LiveChat videoId={videoId} isReplay={chat.isReplay} />}
      {isQueuePanelOpen && (
        <div className={SIDEBAR_PANEL}>
          <QueuePanel />
        </div>
      )}
      {isChaptersPanelOpen && <div className={SIDEBAR_PANEL}>{chaptersPanel}</div>}
    </>
  );
}
