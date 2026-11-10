import { Download, Loader2, Trash2 } from "lucide-react";

import type { DownloadCollectionRecord } from "../../lib/api/downloads";
import { getString } from "../../lib/i18n/index";
import type { CollectionDownloadState } from "../../lib/useCollectionDownloads";
import { MusicItemCard } from "../music/MusicItemCard";
import type { MediaMenuAction } from "../ui/MediaMenu";
import { PlaylistCard } from "../video/PlaylistCard";

function CollectionProgressOverlay({ progress }: { progress: CollectionDownloadState }) {
  const { total, completed, active } = progress;
  const percent = total > 0 ? Math.min(100, (completed / total) * 100) : 0;
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-chrome-black/60 p-3 text-chrome-white">
      <div className="flex items-center gap-2">
        {active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        <span className="min-w-0 flex-1 truncate text-xs font-medium tabular-nums">
          {getString("downloads_collection_progress", completed, total)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chrome-white/25">
        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

interface DownloadCollectionCardProps {
  collection: DownloadCollectionRecord;
  progress: CollectionDownloadState;
  onOpen: () => void;
  onDelete: () => void;
}

/** A saved playlist or album on the cards used everywhere else, with its progress and a way to remove it. */
export function DownloadCollectionCard({ collection, progress, onOpen, onDelete }: DownloadCollectionCardProps) {
  const thumbnail = collection.coverUrl ?? collection.thumbnailUrl;
  const overlay = progress.isComplete ? undefined : <CollectionProgressOverlay progress={progress} />;
  const remove: MediaMenuAction = {
    id: "remove-download",
    label: getString("downloads_remove"),
    icon: <Trash2 size={16} />,
    group: "library",
    danger: true,
    onSelect: onDelete,
  };

  if (collection.kind === "album") {
    return (
      <MusicItemCard
        variant="album"
        fill
        item={{
          browseId: collection.collectionId,
          playlistId: "",
          title: collection.title,
          artists: collection.author ? [{ name: collection.author, id: null }] : null,
          year: null,
          thumbnail: thumbnail ?? "",
          explicit: false,
        }}
        onOpen={onOpen}
        onPlay={onOpen}
        thumbnailOverlay={overlay}
        appendActions={[remove]}
      />
    );
  }
  return (
    <PlaylistCard
      playlist={{
        type: "playlist",
        id: collection.collectionId,
        title: collection.title,
        thumbnailUrl: thumbnail,
        videoCount: progress.total,
      }}
      onClick={onOpen}
      thumbnailOverlay={overlay}
      appendActions={[remove]}
    />
  );
}
