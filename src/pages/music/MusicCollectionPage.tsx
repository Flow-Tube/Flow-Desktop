import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Play } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { PlaylistFormDialog } from '../../components/playlist/PlaylistFormDialog';
import { MusicCollectionHeader } from '../../components/music/MusicCollectionHeader';
import { MusicCollectionSkeleton } from '../../components/music/MusicCollectionSkeleton';
import { MusicCollectionSuggestions } from '../../components/music/MusicCollectionSuggestions';
import { CollectionFilterBar, CollectionSelectionBar } from '../../components/music/MusicCollectionToolbar';
import { MusicCollectionTrackList } from '../../components/music/MusicCollectionTrackList';
import { MusicItemCard } from '../../components/music/MusicItemCard';
import { MusicShelf } from '../../components/music/MusicShelf';
import { useMusicCollection, type CollectionKind } from '../../lib/useMusicCollection';
import { usePublishTitle } from '../../lib/usePublishTitle';
import { loadMusicPlaylistSongs, useCollectionDownloadState } from '../../lib/useCollectionDownloads';
import { useCollectionSuggestions } from '../../lib/useCollectionSuggestions';
import { useCollectionView } from '../../lib/useCollectionView';
import {
  addSongsToQueue,
  downloadSongs,
  playSongsNext,
  removeSongsWithUndo,
} from '../../lib/useCollectionSelectionActions';
import { useSongSelection } from '../../lib/useSongSelection';
import { shareLink } from '../../lib/clipboard';
import { youtubeMusicAlbumUrl, youtubeMusicPlaylistUrl } from '../../lib/youtubeUrl';
import { songToastItem } from '../../lib/songLikeToast';
import { useUiStore } from '../../store/useUiStore';
import { useDownloadStore } from '../../store/useDownloadStore';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { albumDetailPath, useAlbumLibraryStore } from '../../store/useAlbumLibraryStore';
import { getString } from '../../lib/i18n/index';
import type { AlbumItem, SongItem } from '../../types/music';
import { shuffled } from '../../lib/musicRecall';
import { songToFileEntry } from '../../lib/playlistFile';
import { savePlaylistFileWithToast } from '../../lib/playlistTransfer';
import { showSaveFailedToast, showSaveToast } from '../../lib/saveToast';

const videoIdOf = (t: SongItem) => t.videoId ?? t.id;

const PLAYLIST_AUTO_LOAD_CEILING = 500;

function parseTrackCount(text: string | null): number | null {
  if (!text) return null;
  const digits = text.match(/[\d,]+/)?.[0]?.replace(/,/g, '');
  if (!digits) return null;
  const count = Number.parseInt(digits, 10);
  return Number.isFinite(count) ? count : null;
}

export default function MusicCollectionPage({ kind }: { kind: CollectionKind }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const addToQueue = useMusicPlayerStore((s) => s.addToQueue);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const ownedAlbums = useAlbumLibraryStore((s) => s.albums);
  const addAlbumTracks = useAlbumLibraryStore((s) => s.addTracks);
  const removeAlbumTracks = useAlbumLibraryStore((s) => s.removeTracks);
  const updateAlbumDetails = useAlbumLibraryStore((s) => s.updateDetails);
  const openAddToAlbum = useAlbumLibraryStore((s) => s.openAddToAlbum);
  const toggleAlbumSave = useAlbumLibraryStore((s) => s.toggle);
  const isAlbumSaved = useAlbumLibraryStore((s) => (kind === 'album' && id ? s.isSaved(id) : false));
  const openTrackSearch = useAlbumLibraryStore((s) => s.openTrackSearch);
  const [showMiniHeader, setShowMiniHeader] = useState(false);
  const [editing, setEditing] = useState(false);

  const { meta, songs, otherVersions, loading, loadingMore, error, hasMore, loadMore, reload, ownedAlbumId } =
    useMusicCollection(kind, id);
  usePublishTitle(meta?.title);

  const ownedAlbum = ownedAlbumId ? ownedAlbums.find((album) => album.id === ownedAlbumId) ?? null : null;
  const view = useCollectionView({
    id,
    songs,
    isAlbumKind: kind === 'album',
    isOwned: Boolean(ownedAlbumId),
    hasMore,
    loadingMore,
    loadMore,
  });
  const selection = useSongSelection(view.ordered, view.shown);
  const stopSelection = selection.stop;
  useEffect(() => stopSelection(), [id, stopSelection]);
  const suggestions = useCollectionSuggestions(ownedAlbumId, songs);
  const requestSuggestions = suggestions.requestOnce;
  const showSuggestions = Boolean(ownedAlbumId) && !selection.selecting && !view.debouncedQuery.trim();

  const openCollectionDownload = useDownloadStore((s) => s.openCollection);
  const albumDownloadState = useCollectionDownloadState(id, 'album');

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

  const listEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showSuggestions || songs.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const target = listEndRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) requestSuggestions();
      },
      { root: scrollRef.current },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [requestSuggestions, showSuggestions, songs.length]);

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

  if (loading && !meta) return <MusicCollectionSkeleton />;

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
    const start = Math.max(0, view.ordered.findIndex((t) => videoIdOf(t) === videoIdOf(track)));
    void playQueue(view.ordered, start, meta?.title ?? null);
  };
  const playAll = (shuffle: boolean) => {
    if (!view.ordered.length) return;
    void playQueue(shuffle ? shuffled(view.ordered) : view.ordered, 0, meta?.title ?? null);
  };

  const isOnlineAlbum = kind === 'album' && !ownedAlbumId;

  const handleDownloadAlbum = () => {
    if (!id || songs.length === 0) return;
    openCollectionDownload({
      kind: 'album',
      meta: {
        collectionId: id,
        title: meta.title,
        author: meta.artistName || undefined,
        thumbnailUrl: meta.thumbnail ?? undefined,
        year: meta.yearText ? Number.parseInt(meta.yearText, 10) || null : null,
      },
      load: () => (kind === 'playlist' && hasMore ? loadMusicPlaylistSongs(id) : Promise.resolve(songs)),
    });
  };

  const handleExport = () => {
    void savePlaylistFileWithToast({
      name: meta.title,
      description: ownedAlbumId ? meta.description ?? '' : '',
      isMusic: true,
      videos: songs.map(songToFileEntry),
    });
  };

  const saveDetails = (title: string, description: string) => {
    if (!ownedAlbumId) return;
    void updateAlbumDetails(ownedAlbumId, title, description).catch((error) => {
      console.error('Failed to save the album', error);
      useUiStore.getState().showToast({ variant: 'error', message: getString('album_edit_failed') });
    });
  };

  const handleShare = () => {
    if (!id) return;
    const url = kind === 'album' ? youtubeMusicAlbumUrl(id) : youtubeMusicPlaylistUrl(id);
    void shareLink(meta.title, url).then((result) => {
      const { showToast } = useUiStore.getState();
      if (result === 'copied') showToast({ variant: 'success', message: getString('share_link_copied') });
      if (result === 'failed') showToast({ variant: 'error', message: getString('share_link_copy_failed') });
    });
  };

  const removeSongs = (tracks: SongItem[]) => {
    if (ownedAlbum) void removeSongsWithUndo(ownedAlbum, tracks);
  };

  const addSuggestion = (song: SongItem) => {
    if (!ownedAlbum) return;
    const destination = { kind: 'album' as const, path: albumDetailPath(ownedAlbum), name: ownedAlbum.title };
    void addAlbumTracks(ownedAlbum.id, [song])
      .then(() =>
        showSaveToast({
          destination,
          item: songToastItem(song),
          undo: () => removeAlbumTracks(ownedAlbum.id, [videoIdOf(song)]),
        }),
      )
      .catch((error) => {
        console.error('Failed to add the song to the album', error);
        showSaveFailedToast({ destination, item: songToastItem(song) });
      });
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
    const toastItem = { title: meta.title, image: meta.thumbnail, shape: 'square' as const };
    void toggleAlbumSave(albumItem).then((nowSaved) => {
      showSaveToast({
        destination: { kind: 'albums' },
        item: toastItem,
        removed: !nowSaved,
        undo: () => toggleAlbumSave(albumItem),
      });
    }).catch((error) => {
      console.error('Failed to update the album library', error);
      showSaveFailedToast({ destination: { kind: 'albums' }, item: toastItem });
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
        className={`sticky top-0 z-40 -mb-14 flex h-14 items-center border-b border-chrome-neutral-800 bg-surface/95 px-8 transition-all duration-200 ease-out ${
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
        onDownload={handleDownloadAlbum}
        downloadActive={albumDownloadState.active}
        downloadComplete={albumDownloadState.isComplete}
        onExport={songs.length > 0 && !hasMore ? handleExport : undefined}
        onShare={ownedAlbumId ? undefined : handleShare}
        onEdit={ownedAlbumId ? () => setEditing(true) : undefined}
      />

      {editing && ownedAlbum ? (
        <PlaylistFormDialog
          title={getString('album_edit')}
          confirmLabel={getString('save')}
          initialName={ownedAlbum.title}
          initialDescription={ownedAlbum.description ?? ''}
          onSubmit={(title, description) => {
            saveDetails(title, description);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-8 pt-6">
        {songs.length > 0 ? (
          <div className="sticky top-14 z-30 -mx-2 bg-surface px-2 py-2">
            {selection.selecting ? (
              <CollectionSelectionBar
                count={selection.selectedSongs.length}
                allSelected={selection.allSelected}
                onToggleAll={selection.toggleAll}
                onDone={selection.stop}
                onPlayNext={() => {
                  playSongsNext(selection.selectedSongs);
                  selection.stop();
                }}
                onAddToQueue={() => {
                  addSongsToQueue(selection.selectedSongs);
                  selection.stop();
                }}
                onAddToAlbum={() => {
                  openAddToAlbum(selection.selectedSongs);
                  selection.stop();
                }}
                onDownload={() => {
                  void downloadSongs(selection.selectedSongs);
                  selection.stop();
                }}
                onRemove={
                  ownedAlbumId
                    ? () => {
                        removeSongs(selection.selectedSongs);
                        selection.stop();
                      }
                    : undefined
                }
              />
            ) : (
              <CollectionFilterBar
                isAlbumKind={kind === 'album'}
                query={view.query}
                onQueryChange={view.setQuery}
                sortOrder={view.sortOrder}
                sortOrders={view.sortOrders}
                onSortChange={view.setSortOrder}
                onSelect={selection.start}
              />
            )}
          </div>
        ) : null}

        <MusicCollectionTrackList
          songs={view.shown}
          positions={view.positions}
          totalSongs={songs.length}
          query={view.debouncedQuery}
          isAlbumKind={kind === 'album'}
          artistName={meta.artistName}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          selectedIds={selection.selectedIds}
          onToggleSelected={selection.toggle}
          onPlay={playFrom}
          onAddToQueue={addToQueue}
          onRemove={ownedAlbumId ? (track) => removeSongs([track]) : undefined}
        />

        <div ref={listEndRef} className="h-px w-full" />

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

        {showSuggestions ? (
          <MusicCollectionSuggestions
            songs={suggestions.suggestions}
            loading={suggestions.loading}
            currentTrackId={currentTrackId}
            isPlaying={isPlaying}
            onRefresh={suggestions.refresh}
            onPlay={(song) => {
              const start = suggestions.suggestions.findIndex((t) => videoIdOf(t) === videoIdOf(song));
              void playQueue(suggestions.suggestions, Math.max(0, start), meta.title);
            }}
            onAddToQueue={addToQueue}
            onAdd={addSuggestion}
          />
        ) : null}
      </div>
      {kind === 'album' && otherVersions.length > 0 && <div className="mx-auto max-w-[1600px] px-8 pt-8">
        <MusicShelf title={getString('music_other_versions')} items={otherVersions}
          renderItem={(album) => <MusicItemCard variant="album" item={album}
            onPlay={() => navigate(`/music/album/${album.browseId}`)}
            onOpen={() => navigate(`/music/album/${album.browseId}`)} />} />
      </div>}
    </div>
  );
}
