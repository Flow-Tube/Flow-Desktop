import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Play } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { AlbumTrackRow } from '../../components/music/AlbumTrackRow';
import { MusicCollectionHeader } from '../../components/music/MusicCollectionHeader';
import { useMusicCollection, type CollectionKind } from '../../lib/useMusicCollection';
import { usePublishTitle } from '../../lib/usePublishTitle';
import { useCollectionDownloadState } from '../../lib/useCollectionDownloads';
import { useCollectionDownloadStore } from '../../store/useCollectionDownloadStore';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { useAlbumLibraryStore } from '../../store/useAlbumLibraryStore';
import { useUiStore } from '../../store/useUiStore';
import { getString } from '../../lib/i18n/index';
import { artistsText } from '../../lib/musicFormat';
import type { AlbumItem, SongItem } from '../../types/music';

const videoIdOf = (t: SongItem) => t.videoId ?? t.id;

const PLAYLIST_AUTO_LOAD_CEILING = 500;

function parseTrackCount(text: string | null): number | null {
  if (!text) return null;
  const digits = text.match(/[\d,]+/)?.[0]?.replace(/,/g, '');
  if (!digits) return null;
  const count = Number.parseInt(digits, 10);
  return Number.isFinite(count) ? count : null;
}

function CollectionSkeleton() {
  return (
    <div className="animate-pulse pb-32">
      <div className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-end lg:p-8">
        <div className="h-44 w-44 shrink-0 rounded-2xl bg-surface-container-low lg:h-52 lg:w-52" />
        <div className="flex w-full flex-col items-center gap-3 sm:items-start">
          <div className="h-3 w-16 rounded bg-surface-container-low" />
          <div className="h-9 w-2/3 max-w-md rounded-lg bg-surface-container-low" />
          <div className="h-4 w-40 rounded bg-surface-container-low" />
          <div className="mt-3 h-12 w-56 rounded-full bg-surface-container-low" />
        </div>
      </div>
      <div className="mx-auto flex max-w-[1100px] flex-col gap-1 px-6 pt-6 lg:px-8">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-2">
            <div className="h-12 w-12 shrink-0 rounded-md bg-surface-container-low" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-3.5 w-1/2 rounded bg-surface-container-low" />
              <div className="h-3 w-1/3 rounded bg-surface-container-low" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MusicCollectionPage({ kind }: { kind: CollectionKind }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const addToQueue = useMusicPlayerStore((s) => s.addToQueue);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const removeAlbumTrack = useAlbumLibraryStore((s) => s.removeTrack);
  const toggleAlbumSave = useAlbumLibraryStore((s) => s.toggle);
  const isAlbumSaved = useAlbumLibraryStore((s) => (kind === 'album' && id ? s.isSaved(id) : false));
  const openTrackSearch = useAlbumLibraryStore((s) => s.openTrackSearch);
  const showToast = useUiStore((s) => s.showToast);
  const [showMiniHeader, setShowMiniHeader] = useState(false);

  const { meta, songs, loading, loadingMore, error, hasMore, loadMore, reload, ownedAlbumId } =
    useMusicCollection(kind, id);
  usePublishTitle(meta?.title);

  const startAlbumDownload = useCollectionDownloadStore((s) => s.startAlbum);
  const albumDownloadState = useCollectionDownloadState(kind === 'album' ? id : undefined, 'album');

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore || loadingMore || typeof IntersectionObserver === 'undefined') return;
    const target = sentinelRef.current;
    if (!target) return;
    const root = scrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root, rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadMore]);

  const expectedTrackCount = parseTrackCount(meta?.trackCountText ?? null);
  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;
    if (!expectedTrackCount || songs.length >= expectedTrackCount) return;
    if (kind !== 'album' && expectedTrackCount > PLAYLIST_AUTO_LOAD_CEILING) return;
    void loadMore();
  }, [expectedTrackCount, hasMore, kind, loading, loadingMore, loadMore, songs.length]);

  const handleScroll = () => {
    const nextVisible = (scrollRef.current?.scrollTop ?? 0) > 280;
    setShowMiniHeader((visible) => (visible === nextVisible ? visible : nextVisible));
  };

  if (loading && !meta) return <CollectionSkeleton />;

  if (error || !meta) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <AlertTriangle className="h-8 w-8 text-chrome-neutral-500" />
        <p className="text-sm text-chrome-neutral-400">{getString('music_collection_unavailable')}</p>
        <div className="flex items-center gap-3">
          <Button variant="tonal" onClick={() => navigate(-1)}>
            {getString('music_artist_back')}
          </Button>
          <Button variant="primary" onClick={() => void reload()}>
            {getString('music_retry')}
          </Button>
        </div>
      </div>
    );
  }

  const playFrom = (track: SongItem) => {
    const start = Math.max(0, songs.findIndex((t) => videoIdOf(t) === videoIdOf(track)));
    void playQueue(songs, start);
  };
  const playAll = (shuffle: boolean) => {
    if (!songs.length) return;
    void playQueue(shuffle ? [...songs].sort(() => Math.random() - 0.5) : songs, 0);
  };

  const isOnlineAlbum = kind === 'album' && !ownedAlbumId;

  const handleDownloadAlbum = () => {
    if (!id || songs.length === 0) return;
    void startAlbumDownload(
      {
        collectionId: id,
        title: meta.title,
        author: meta.artistName || undefined,
        thumbnailUrl: meta.thumbnail ?? undefined,
      },
      songs,
    );
  };

  const handleToggleSave = () => {
    if (!id) return;
    const albumItem: AlbumItem = {
      browseId: id,
      playlistId: '',
      title: meta.title,
      artists: meta.artistName ? [{ name: meta.artistName, id: meta.artistId }] : null,
      year: meta.yearText ? Number.parseInt(meta.yearText, 10) || null : null,
      thumbnail: meta.thumbnail ?? '',
      explicit: false,
    };
    void toggleAlbumSave(albumItem).then((nowSaved) => {
      showToast({
        variant: 'success',
        message: getString(nowSaved ? 'music_saved_to_library' : 'music_removed_from_library'),
      });
    });
  };

  const currentTrackId = currentTrack ? videoIdOf(currentTrack) : null;
  const openArtist = meta.artistId
    ? () => navigate(`/music/artist/${meta.artistId}`)
    : undefined;
  const loadedCountLabel = expectedTrackCount
    ? getString('music_loaded_songs_count', songs.length, expectedTrackCount)
    : getString('music_loaded_songs_simple', songs.length);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-full min-h-0 overflow-y-auto pb-32"
    >
      <div
        className={`sticky top-0 z-40 -mb-14 flex h-14 items-center border-b border-chrome-neutral-800 bg-surface/95 px-8 transition-all duration-200 ease-out backdrop-blur ${
          showMiniHeader
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-full opacity-0'
        }`}
      >
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3">
          <button
            type="button"
            disabled={songs.length === 0}
            onClick={() => playAll(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-chrome-neutral-100 text-chrome-neutral-950 transition-colors duration-200 ease-out hover:bg-chrome-white disabled:pointer-events-none disabled:opacity-50"
            aria-label={getString('music_play')}
          >
            <Play className="h-4 w-4" fill="currentColor" />
          </button>
          <span className="line-clamp-1 text-sm font-semibold text-chrome-neutral-100">
            {meta.title}
          </span>
        </div>
      </div>

      <MusicCollectionHeader
        meta={meta}
        canPlay={songs.length > 0}
        onPlay={() => playAll(false)}
        onShuffle={() => playAll(true)}
        onArtistClick={openArtist}
        saved={isOnlineAlbum ? isAlbumSaved : undefined}
        onToggleSave={isOnlineAlbum ? handleToggleSave : undefined}
        onAddTracks={ownedAlbumId ? () => openTrackSearch(ownedAlbumId) : undefined}
        onDownload={kind === 'album' ? handleDownloadAlbum : undefined}
        downloadActive={albumDownloadState.active}
        downloadComplete={albumDownloadState.isComplete}
      />

      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-8 pt-6">
        <div className="mb-4 flex items-center border-b border-chrome-neutral-800/50 px-4 pb-2 text-xs font-semibold uppercase tracking-wider text-chrome-neutral-500">
          <span className="w-12 shrink-0">#</span>
          <span className="min-w-0 flex-1">{getString('music_track_title_column')}</span>
          <span className="hidden w-32 shrink-0 text-right lg:block">
            {getString('music_streams_column')}
          </span>
          <span className="ml-4 w-[72px] shrink-0" aria-hidden="true" />
          <span className="w-16 shrink-0 text-right">{getString('music_time_column')}</span>
        </div>

        <div className="flex flex-col">
          {songs.map((song, i) => {
            const songId = videoIdOf(song);
            const isCurrentSong = currentTrackId === songId;
            // On albums the per-track artist just repeats the album artist, so show it
            // only for featured artists that differ; the play count takes the Streams column.
            const trackArtist = artistsText(song.artists);
            const showArtist =
              kind !== 'album' || (!!trackArtist && trackArtist !== meta.artistName);

            return (
              <AlbumTrackRow
                key={`${songId}-${i}`}
                track={song}
                index={i}
                isCurrent={isCurrentSong}
                isPlaying={isPlaying}
                streamsText={song.viewsText}
                showArtist={showArtist}
                onPlay={playFrom}
                onAddToQueue={addToQueue}
                onRemove={
                  ownedAlbumId
                    ? (t) => void removeAlbumTrack(ownedAlbumId, videoIdOf(t))
                    : undefined
                }
              />
            );
          })}
        </div>

        {(hasMore || songs.length > 0) && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div ref={sentinelRef} className="h-px w-full" />
            <p className="text-xs font-medium uppercase tracking-wider text-chrome-neutral-500">
              {loadedCountLabel}
            </p>
            {hasMore ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-5 py-2.5 text-sm font-medium text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest disabled:pointer-events-none disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loadingMore
                  ? getString('music_loading_more_songs')
                  : getString('music_load_more_songs')}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
