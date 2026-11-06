import { Loader2, Plus, RefreshCw } from 'lucide-react';

import { getString } from '../../lib/i18n/index';
import type { SongItem } from '../../types/music';
import { AlbumTrackRow } from './AlbumTrackRow';

interface MusicCollectionSuggestionsProps {
  songs: SongItem[];
  loading: boolean;
  currentTrackId: string | null;
  isPlaying: boolean;
  onRefresh: () => void;
  onPlay: (song: SongItem) => void;
  onAddToQueue: (song: SongItem) => void;
  onAdd: (song: SongItem) => void;
}

/** Songs to add under your own list. Nothing shows when there are none to offer. */
export function MusicCollectionSuggestions({
  songs,
  loading,
  currentTrackId,
  isPlaying,
  onRefresh,
  onPlay,
  onAddToQueue,
  onAdd,
}: MusicCollectionSuggestionsProps) {
  if (songs.length === 0 && !loading) return null;
  return (
    <section className="flex flex-col gap-2 pt-4">
      <div className="flex items-center justify-between px-4">
        <h2 className="text-base font-medium text-chrome-neutral-100">{getString('music_collection_suggestions')}</h2>
        {!loading ? (
          <button
            type="button"
            onClick={onRefresh}
            aria-label={getString('music_collection_suggestions_refresh')}
            title={getString('music_collection_suggestions_refresh')}
            className="grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {loading ? (
        <div className="flex justify-center py-6 text-chrome-neutral-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col">
          {songs.map((song, index) => (
            <div key={song.videoId ?? song.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <AlbumTrackRow
                  track={song}
                  index={index}
                  isCurrent={currentTrackId === (song.videoId ?? song.id)}
                  isPlaying={isPlaying}
                  showArtwork
                  showStreamsColumn={false}
                  onPlay={onPlay}
                  onAddToQueue={onAddToQueue}
                />
              </div>
              <button
                type="button"
                onClick={() => onAdd(song)}
                aria-label={getString('music_add_to_album')}
                title={getString('music_add_to_album')}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-container-high text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
