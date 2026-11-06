import { useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import type { LocalMediaFile } from "../../lib/api/localMedia";
import { formatBytes } from "../../lib/downloadOptions";
import { getString } from "../../lib/i18n/index";
import { progressFraction, watchStateOf, type PlaysById } from "../../lib/localMedia/filters";
import { localFileToSong, localFileToVideo } from "../../lib/localMedia/items";
import { useLocalCover } from "../../lib/localMedia/useLocalCover";
import { localFileMenuActions } from "../../lib/localMedia/useLocalFileMenu";
import { MusicItemCard } from "../music/MusicItemCard";
import { VideoCard } from "../video/VideoCard";
import { LocalFileDetailsDialog } from "./LocalFileDetailsDialog";

interface LocalFileItemProps {
  file: LocalMediaFile;
  plays: PlaysById;
  nowMs: number;
  onPlay: () => void;
}

/** The file's menu actions, with the details dialog they can open. */
function useLocalFileMenu(file: LocalMediaFile): { actions: ReturnType<typeof localFileMenuActions>; dialog: ReactNode } {
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);
  return {
    actions: localFileMenuActions(file, { navigate, onDetails: () => setShowDetails(true) }),
    dialog: showDetails ? <LocalFileDetailsDialog file={file} onClose={() => setShowDetails(false)} /> : null,
  };
}

/** A video file on the app's video card. */
export function LocalFileCard({ file, plays, nowMs, onPlay }: LocalFileItemProps) {
  const frame = useRef<HTMLDivElement>(null);
  const cover = useLocalCover(file.id, frame);
  const menu = useLocalFileMenu(file);
  const percent = progressFraction(file, plays) * 100;
  const video = useMemo(
    () => ({
      ...localFileToVideo(file),
      thumbnailUrl: cover,
      viewCountText: formatBytes(file.sizeBytes) ?? undefined,
      watchProgressPercent: percent,
    }),
    [file, cover, percent],
  );
  return (
    <div ref={frame} className="min-w-0">
      <VideoCard
        video={video}
        variant={percent > 0 ? "continue" : "default"}
        hideChannelAvatar
        onPlay={onPlay}
        menuActions={menu.actions}
        thumbnailOverlay={
          watchStateOf(file, plays, nowMs) === "new" ? (
            <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-on-primary">
              {getString("local_new_badge")}
            </span>
          ) : undefined
        }
      />
      {menu.dialog}
    </div>
  );
}

/** A song file on the app's track row. */
export function LocalFileRow({ file, onPlay }: Pick<LocalFileItemProps, "file" | "onPlay">) {
  const frame = useRef<HTMLDivElement>(null);
  const cover = useLocalCover(file.id, frame);
  const menu = useLocalFileMenu(file);
  const song = useMemo(() => ({ ...localFileToSong(file), thumbnail: cover ?? "" }), [file, cover]);
  return (
    <div ref={frame} className="min-w-0">
      <MusicItemCard
        variant="track-list"
        item={song}
        className="bg-surface-container-low pe-3"
        onPlay={onPlay}
        menuActions={menu.actions}
      />
      {menu.dialog}
    </div>
  );
}
