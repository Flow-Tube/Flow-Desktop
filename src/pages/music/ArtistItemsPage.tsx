import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Play, Shuffle } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { MusicItemCard } from '../../components/music/MusicItemCard';
import { useArtistItems } from '../../lib/useArtistPage';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { getString } from '../../lib/i18n/index';
import { useGridStyle } from '../../lib/useGridColumns';
import type { SongItem, YTItem } from '../../types/music';

const videoIdOf = (t: SongItem) => t.videoId ?? t.id;

type ItemKind = 'songs' | 'albums';

function GridSkeleton({ kind }: { kind: ItemKind }) {
  const gridStyle = useGridStyle({ density: 'dense' });
  const count = 12;
  if (kind === 'songs') {
    return (
      <div className="grid animate-pulse gap-x-8 gap-y-1 lg:grid-cols-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-2">
            <div className="h-12 w-12 shrink-0 rounded-md bg-surface-container-low" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-3.5 w-1/2 rounded bg-surface-container-low" />
              <div className="h-3 w-1/3 rounded bg-surface-container-low" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flow-grid gap-y-6" style={gridStyle}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex animate-pulse flex-col gap-3">
          <div className="aspect-square w-full rounded-xl bg-surface-container-low" />
          <div className="h-3.5 w-3/4 rounded bg-surface-container-low" />
          <div className="h-3 w-1/2 rounded bg-surface-container-low" />
        </div>
      ))}
    </div>
  );
}

export default function ArtistItemsPage() {
  const gridStyle = useGridStyle({ density: 'dense' });
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const addToQueue = useMusicPlayerStore((s) => s.addToQueue);

  const browseId = sp.get('browseId') ?? undefined;
  const params = sp.get('params') ?? undefined;
  const kind: ItemKind = sp.get('kind') === 'songs' ? 'songs' : 'albums';
  const title = sp.get('title') ?? '';

  const { items, loading, loadingMore, error, loadMore, hasMore } = useArtistItems(browseId, params);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore || loadingMore || typeof IntersectionObserver === 'undefined') return;
    const target = sentinelRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadMore]);

  const songs = items.filter((i): i is Extract<YTItem, { type: 'song' }> => i.type === 'song');
  const collections = items.filter(
    (i): i is Extract<YTItem, { type: 'album' | 'playlist' }> =>
      i.type === 'album' || i.type === 'playlist',
  );

  const playFrom = (track: SongItem) => {
    const start = Math.max(0, songs.findIndex((t) => videoIdOf(t) === videoIdOf(track)));
    void playQueue(songs, start);
  };
  const playAll = (shuffle: boolean) => {
    if (!songs.length) return;
    void playQueue(shuffle ? [...songs].sort(() => Math.random() - 0.5) : songs, 0);
  };

  const openAlbum = (browse: string) => navigate(`/music/album/${browse}`);
  const openPlaylist = (id: string) => navigate(`/music/playlist/${id}`);

  return (
    <div className="px-6 py-6 pb-32 lg:px-8">
      <div className="mb-6 flex items-center gap-3">

        <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{title}</h1>
      </div>

      {error && !items.length ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <AlertTriangle className="h-8 w-8 text-chrome-neutral-500" />
          <p className="text-sm text-chrome-neutral-400">{getString('music_error_generic')}</p>
        </div>
      ) : loading && !items.length ? (
        <GridSkeleton kind={kind} />
      ) : kind === 'songs' ? (
        <>
          {songs.length > 0 && (
            <div className="mb-6 flex items-center gap-3">
              <Button variant="primary" size="lg" onClick={() => playAll(false)}>
                <Play size={18} fill="currentColor" />
                {getString('music_play')}
              </Button>
              <Button variant="tonal" size="lg" onClick={() => playAll(true)}>
                <Shuffle size={18} />
                {getString('music_shuffle')}
              </Button>
            </div>
          )}
          <div className="grid gap-x-8 gap-y-1 lg:grid-cols-2">
            {songs.map((song) => (
              <MusicItemCard
                key={videoIdOf(song)}
                variant="track-list"
                item={song}
                onPlay={() => playFrom(song)}
                onMenu={() => addToQueue(song)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="flow-grid gap-y-6" style={gridStyle}>
          {collections.map((item, i) =>
            item.type === 'album' ? (
              <MusicItemCard
                key={item.browseId || i}
                variant="album"
                item={item}
                fill
                onOpen={() => openAlbum(item.browseId)}
                onPlay={() => openAlbum(item.browseId)}
              />
            ) : (
              <MusicItemCard
                key={item.id || i}
                variant="playlist"
                item={item}
                fill
                onOpen={() => openPlaylist(item.id)}
                onPlay={() => openPlaylist(item.id)}
              />
            ),
          )}
        </div>
      )}

      {hasMore && (
        <div className="flex flex-col items-center gap-3 py-10">
          <div ref={sentinelRef} className="h-px w-full" />
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-5 py-2.5 text-sm font-medium text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest disabled:opacity-50"
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {getString('music_load_more')}
          </button>
        </div>
      )}
    </div>
  );
}
