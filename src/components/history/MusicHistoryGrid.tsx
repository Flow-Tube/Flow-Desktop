import { useMemo } from "react";
import { X } from "lucide-react";
import { MusicItemCard } from "../music/MusicItemCard";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { historyVideoToSong, type HistoryVideo } from "../../lib/useHistory";
import { getString } from "../../lib/i18n/index";

interface MusicHistoryGridProps {
  videos: HistoryVideo[];
  onRemoveFromHistory: (videoId: string) => void;
}

export function MusicHistoryGrid({ videos, onRemoveFromHistory }: MusicHistoryGridProps) {
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const songs = useMemo(() => videos.map(historyVideoToSong), [videos]);

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
      {videos.map((video, index) => (
        <MusicItemCard
          key={`${video.id}-${index}`}
          variant="track-list"
          item={historyVideoToSong(video)}
          className="bg-surface-container-low pr-3"
          onPlay={() => void playQueue(songs, index)}
          appendActions={[
            {
              id: "remove-from-history",
              label: getString("music_remove_from_history"),
              icon: <X size={16} />,
              onSelect: () => onRemoveFromHistory(video.id),
            },
          ]}
        />
      ))}
    </div>
  );
}

export default MusicHistoryGrid;
