import { useMemo } from "react";
import { X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { likedItemKey, likedSongs } from "../../lib/likedItems";
import { likedVideoToHistoryVideo } from "../../lib/useLikes";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import type { LikedItem } from "../../store/useLikesStore";
import type { VideoSummary } from "../../types/video";
import { SelectableRow } from "../common/SelectableRow";
import { MusicItemCard } from "../music/MusicItemCard";
import { VideoCard } from "../video/VideoCard";

interface LikesFlatListProps {
  items: LikedItem[];
  selecting: boolean;
  selectedKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onPlay: (video: VideoSummary) => void;
  onRemove: (item: LikedItem) => void;
}

/** Likes in one list, for orders the date groups can't show and for picking rows. */
export function LikesFlatList({ items, selecting, selectedKeys, onToggle, onPlay, onRemove }: LikesFlatListProps) {
  const playQueue = useMusicPlayerStore((state) => state.playQueue);
  const songs = useMemo(() => likedSongs(items), [items]);

  return (
    <div className="mt-8 flex flex-col gap-3">
      {items.map((item) => {
        const key = likedItemKey(item);
        return (
          // Skips layout for rows off screen, which a long list of likes needs.
          <div key={key} className="[contain-intrinsic-size:auto_96px] [content-visibility:auto]">
            <SelectableRow selecting={selecting} selected={selectedKeys.has(key)} onToggle={() => onToggle(key)}>
              {item.kind === "video" ? (
                <VideoCard
                  variant="list"
                  video={likedVideoToHistoryVideo(item)}
                  onPlay={onPlay}
                  onRemoveFromLikes={() => onRemove(item)}
                />
              ) : (
                <MusicItemCard
                  variant="track-list"
                  item={item.song}
                  className="bg-surface-container-low pr-3"
                  onPlay={() => void playQueue(songs, Math.max(0, songs.indexOf(item.song)))}
                  appendActions={[
                    {
                      id: "remove-like",
                      label: getString("remove"),
                      icon: <X size={16} />,
                      onSelect: () => onRemove(item),
                    },
                  ]}
                />
              )}
            </SelectableRow>
          </div>
        );
      })}
    </div>
  );
}
