import { useRef } from "react";
import { useNavigate } from "react-router-dom";

import type { LocalMediaFile } from "../../lib/api/localMedia";
import type { PlaysById } from "../../lib/localMedia/filters";
import { playLocalFiles } from "../../lib/localMedia/playback";
import { useChunkedList } from "../../lib/localMedia/useChunkedList";
import { useGridStyle } from "../../lib/useGridColumns";
import { GRID_INDEX_ATTRIBUTE, useLastVisibleCard } from "../../lib/useLastVisibleCard";
import { LocalFileCard, LocalFileRow } from "./LocalFileCard";

interface LocalFileListProps {
  files: LocalMediaFile[];
  plays: PlaysById;
  nowMs: number;
  isVideos: boolean;
}

/** Videos in the feed's grid, songs in the rows every other music list uses. */
export function LocalFileList({ files, plays, nowMs, isVideos }: LocalFileListProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { count, onLastVisible } = useChunkedList(files, files.length);
  useLastVisibleCard(containerRef, count, onLastVisible);
  const gridStyle = useGridStyle();

  return (
    <div
      ref={containerRef}
      className={isVideos ? "flow-grid gap-y-8 pb-8" : "grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3"}
      style={isVideos ? gridStyle : undefined}
    >
      {files.slice(0, count).map((file, index) => {
        const play = () => playLocalFiles(files, index, navigate);
        return (
          <div key={file.id} className={isVideos ? "flow-grid-card min-w-0 p-2 -m-2" : "min-w-0"} {...{ [GRID_INDEX_ATTRIBUTE]: index }}>
            {isVideos ? <LocalFileCard file={file} plays={plays} nowMs={nowMs} onPlay={play} /> : <LocalFileRow file={file} onPlay={play} />}
          </div>
        );
      })}
    </div>
  );
}
