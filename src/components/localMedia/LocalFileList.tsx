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
  asGrid: boolean;
}

export function LocalFileList({ files, plays, nowMs, asGrid }: LocalFileListProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { count, onLastVisible } = useChunkedList(files, files.length);
  useLastVisibleCard(containerRef, count, onLastVisible);
  const gridStyle = useGridStyle();
  const Item = asGrid ? LocalFileCard : LocalFileRow;

  return (
    <div
      ref={containerRef}
      className={asGrid ? "flow-grid gap-y-6" : "flex flex-col"}
      style={asGrid ? gridStyle : undefined}
    >
      {files.slice(0, count).map((file, index) => (
        <div key={file.id} className="flow-grid-card min-w-0" {...{ [GRID_INDEX_ATTRIBUTE]: index }}>
          <Item file={file} plays={plays} nowMs={nowMs} onPlay={() => playLocalFiles(files, index, navigate)} />
        </div>
      ))}
    </div>
  );
}
