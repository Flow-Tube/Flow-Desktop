import { MusicItemCard } from './MusicItemCard';
import type { PlaylistItem, SongItem } from '../../types/music';

interface Props {
  playlist: PlaylistItem;
  preview: SongItem[];
  onOpen: () => void;
  onPlayPreview: (track: SongItem) => void;
}

export function CommunityPlaylistCard({ playlist, preview, onOpen, onPlayPreview }: Props) {
  return <div className="w-40 md:w-48 lg:w-56">
    <MusicItemCard variant="playlist" item={playlist} onOpen={onOpen} onPlay={onOpen} />
    {preview.length > 0 && <div className="mt-2 flex flex-col gap-0.5 border-t border-chrome-neutral-800 pt-2">
      {preview.slice(0, 3).map((track) => <button key={track.videoId ?? track.id} type="button"
        onClick={() => onPlayPreview(track)}
        className="truncate rounded-md px-1 py-1 text-left text-xs text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]">
        {track.title}
      </button>)}
    </div>}
  </div>;
}
