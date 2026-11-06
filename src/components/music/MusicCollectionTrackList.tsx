import { EmptyState } from '../ui/EmptyState';
import { ListMusic, SearchX } from 'lucide-react';

import { getString } from '../../lib/i18n/index';
import { artistsText } from '../../lib/musicFormat';
import type { SongItem } from '../../types/music';
import { AlbumTrackRow } from './AlbumTrackRow';

interface MusicCollectionTrackListProps {
  songs: SongItem[];
  positions: Map<string, number>;
  totalSongs: number;
  query: string;
  isAlbumKind: boolean;
  artistName: string | null;
  currentTrackId: string | null;
  isPlaying: boolean;
  selectedIds: Set<string> | null;
  onToggleSelected: (song: SongItem, extendRange: boolean) => void;
  onPlay: (song: SongItem) => void;
  onAddToQueue: (song: SongItem) => void;
  onRemove?: (song: SongItem) => void;
}

/** The songs of an album or playlist. A song keeps its number in the page's own order whatever the sort. */
export function MusicCollectionTrackList({
  songs,
  positions,
  totalSongs,
  query,
  isAlbumKind,
  artistName,
  currentTrackId,
  isPlaying,
  selectedIds,
  onToggleSelected,
  onPlay,
  onAddToQueue,
  onRemove,
}: MusicCollectionTrackListProps) {
  if (totalSongs === 0) {
    return (
      <EmptyState
        icon={ListMusic}
        title={getString('music_collection_empty_title')}
        body={onRemove ? getString('music_collection_empty_body') : undefined}
      />
    );
  }
  if (songs.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={getString('music_collection_no_matches', query.trim())}
      />
    );
  }
  return (
    <>
      <div className="mb-4 flex items-center border-b border-chrome-neutral-800/50 px-4 pb-2 text-xs font-semibold uppercase tracking-wider text-chrome-neutral-500">
        <span className="w-12 shrink-0">#</span>
        <span className="min-w-0 flex-1">{getString('music_track_title_column')}</span>
        <span className="hidden w-32 shrink-0 text-end lg:block">{getString('music_streams_column')}</span>
        <span className="ms-4 w-[72px] shrink-0" aria-hidden="true" />
        <span className="w-16 shrink-0 text-end">{getString('music_time_column')}</span>
      </div>

      <div className="flex flex-col">
        {songs.map((song) => {
          const songId = song.videoId ?? song.id;
          // On albums the per-track artist just repeats the album artist, so show it
          // only for featured artists that differ; the play count takes the Streams column.
          const trackArtist = artistsText(song.artists);
          return (
            <AlbumTrackRow
              key={songId}
              track={song}
              index={(positions.get(songId) ?? 1) - 1}
              isCurrent={currentTrackId === songId}
              isPlaying={isPlaying}
              streamsText={song.viewsText}
              showArtist={!isAlbumKind || (!!trackArtist && trackArtist !== artistName)}
              onPlay={onPlay}
              onAddToQueue={onAddToQueue}
              onRemove={onRemove}
              selection={
                selectedIds ? { selected: selectedIds.has(songId), onToggle: onToggleSelected } : undefined
              }
            />
          );
        })}
      </div>
    </>
  );
}
