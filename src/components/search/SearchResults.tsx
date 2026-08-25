import { Loader2, Play, Search as SearchIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { VideoGrid } from '../video/VideoGrid';
import { MusicItemCard } from '../music/MusicItemCard';
import { MusicShelf } from '../music/MusicShelf';
import { ArtistCard } from '../music/ArtistCard';
import { ChannelCard } from '../channel/ChannelCard';
import { PlaylistCard } from '../video/PlaylistCard';
import { Button } from '../ui/Button';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { useMusicHiddenFilter } from '../../store/useMusicActionsStore';
import { useInfiniteScroll } from '../../lib/useInfiniteScroll';
import { getString } from '../../lib/i18n/index';
import { upgradeAvatarUrl, upgradeMusicImageUrl } from '../../lib/thumbnails';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { useGridStyle } from '../../lib/useGridColumns';
import type {
  SearchCategory,
  TopResult,
  UseCombinedSearchReturn,
} from '../../lib/useCombinedSearch';
import type { AlbumItem, ArtistItem, PlaylistItem, SongItem } from '../../types/music';
import type { PlaylistSummary, VideoSummary } from '../../types/video';

interface SearchResultsProps {
  search: UseCombinedSearchReturn;
  onPlayVideo: (v: VideoSummary) => void;
  onAddToQueue: (v: VideoSummary) => void;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function artistsText(artists?: { name: string }[] | null): string {
  if (!artists?.length) return '';
  return artists.map((a) => a.name).filter(Boolean).join(', ');
}

function toPlaylistSummary(p: PlaylistItem): PlaylistSummary {
  return {
    type: 'playlist',
    id: p.id,
    title: p.title,
    thumbnailUrl: p.thumbnail,
    videoCountText: p.songCountText,
  };
}

// Column count and card floor come from the user's grid preference (useGridStyle).
const RESULT_GRID = 'flow-grid gap-y-8';

type ArtistOrChannel = { kind: 'artist'; item: ArtistItem } | { kind: 'channel'; item: VideoSummary };

export function SearchResults({ search, onPlayVideo, onAddToQueue }: SearchResultsProps) {
  const navigate = useNavigate();
  const squareGridStyle = useGridStyle({ density: 'dense' });
  const wideGridStyle = useGridStyle();
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const addSongToQueue = useMusicPlayerStore((s) => s.addToQueue);

  const {
    results: r,
    filterType,
    setFilterType,
    isLoading,
    isFetchingNextPage,
    error,
    query,
    fetchNextPage,
  } = search;

  const sentinelRef = useInfiniteScroll({
    hasNextPage: search.hasNextPage,
    isLoading: isLoading || isFetchingNextPage,
    onLoadMore: fetchNextPage,
  });

  const isHidden = useMusicHiddenFilter();
  // Hide blocked/dismissed songs from music search results.
  const visibleSongs = r.songs.filter((song) => !isHidden(song));

  // --- actions ------------------------------------------------------------
  const playSong = (song: SongItem, context: SongItem[]) => {
    const queue = context.length ? context : [song];
    const id = song.videoId ?? song.id;
    const start = Math.max(0, queue.findIndex((t) => (t.videoId ?? t.id) === id));
    void playQueue(queue, start);
  };
  const openAlbum = (a: AlbumItem) => navigate(`/music/album/${a.browseId}`);
  const openArtist = (a: ArtistItem) => navigate(`/music/artist/${a.id}`);
  const openPlaylist = (p: PlaylistItem) => navigate(`/music/playlist/${p.id}`);
  const openChannel = (v: VideoSummary) =>
    navigate(`/channel/${(v.channelId ?? v.id).replace('channel:', '')}`);

  const hasAny = Boolean(
    r.topResult ||
      r.songs.length ||
      r.videos.length ||
      r.live.length ||
      r.channels.length ||
      r.albums.length ||
      r.playlists.length ||
      r.artists.length ||
      r.podcasts.length ||
      r.episodes.length,
  );

  // --- guard states -------------------------------------------------------
  if (!query) {
    return (
      <EmptyState
        title={getString('search_empty_title')}
        body={getString('search_empty_body')}
      />
    );
  }

  if (isLoading && !hasAny) {
    return <ResultsSkeleton filterType={filterType} />;
  }

  if (error && !hasAny) {
    return <EmptyState title={getString('search_error_title')} body={error} tone="error" />;
  }

  if (!hasAny) {
    return (
      <EmptyState
        title={getString('search_no_results_title', query)}
        body={getString('search_no_results_body')}
      />
    );
  }

  // --- loading sentinel (filtered views only) -----------------------------
  const sentinel = (
    <>
      <div ref={sentinelRef} className="h-10" />
      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-6 text-chrome-neutral-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
    </>
  );

  // ========================================================================
  // "ALL" — categorized shelves (one model per lane)
  // ========================================================================
  if (filterType === 'all') {
    const artistsChannels: ArtistOrChannel[] = [
      ...r.artists.map((item): ArtistOrChannel => ({ kind: 'artist', item })),
      ...r.channels.map((item): ArtistOrChannel => ({ kind: 'channel', item })),
    ];

    return (
      <div className="flex flex-col gap-10 pb-12">
        {r.topResult && (
          <TopResultHero
            top={r.topResult}
            onPlaySong={playSong}
            onPlayVideo={onPlayVideo}
            onOpenAlbum={openAlbum}
            onOpenArtist={openArtist}
            onOpenChannel={openChannel}
          />
        )}

        {visibleSongs.length > 0 && (
          <section className="flex flex-col">
            <ShelfHeader
              title={getString('search_section_songs')}
              onSeeAll={() => setFilterType('songs')}
              seeAllLabel={getString('search_see_all_songs')}
            />
            <div className="flex flex-col gap-1">
              {visibleSongs.slice(0, 4).map((song) => (
                <MusicItemCard
                  key={song.id}
                  variant="track-list"
                  item={song}
                  onPlay={() => playSong(song, visibleSongs)}
                  onMenu={() => addSongToQueue(song)}
                />
              ))}
            </div>
          </section>
        )}

        {r.videos.length > 0 && (
          <section className="flex flex-col">
            <ShelfHeader
              title={getString('search_section_videos')}
              onSeeAll={() => setFilterType('videos')}
              seeAllLabel={getString('search_see_all_videos')}
            />
            <VideoGrid videos={r.videos.slice(0, 8)} onPlay={onPlayVideo} onAddToQueue={onAddToQueue} />
          </section>
        )}

        {r.live.length > 0 && (
          <section className="flex flex-col">
            <ShelfHeader
              title={getString('search_section_live')}
              onSeeAll={() => setFilterType('live')}
              seeAllLabel={getString('search_see_all_live')}
            />
            <VideoGrid videos={r.live.slice(0, 8)} onPlay={onPlayVideo} onAddToQueue={onAddToQueue} />
          </section>
        )}

        {r.albums.length > 0 && (
          <MusicShelf<AlbumItem>
            title={getString('search_cat_albums')}
            onSeeAll={() => setFilterType('albums')}
            items={r.albums}
            renderItem={(a) => (
              <MusicItemCard variant="album" item={a} onPlay={() => openAlbum(a)} onOpen={() => openAlbum(a)} />
            )}
          />
        )}

        {r.playlists.length > 0 && (
          <MusicShelf<PlaylistItem>
            title={getString('search_cat_playlists')}
            onSeeAll={() => setFilterType('playlists')}
            items={r.playlists}
            renderItem={(p) => (
              <div className="w-64">
                <PlaylistCard playlist={toPlaylistSummary(p)} onClick={() => openPlaylist(p)} />
              </div>
            )}
          />
        )}

        {artistsChannels.length > 0 && (
          <MusicShelf<ArtistOrChannel>
            title={getString('search_section_artists_channels')}
            skeletonShape="circle"
            items={artistsChannels}
            renderItem={(it) =>
              it.kind === 'artist' ? (
                <ArtistCard artist={it.item} onOpen={() => openArtist(it.item)} />
              ) : (
                <ChannelCard
                  channelId={it.item.channelId ?? it.item.id}
                  name={it.item.title}
                  avatarUrl={it.item.channelAvatarUrl ?? it.item.thumbnailUrl}
                  subtitle={it.item.publishedText}
                />
              )
            }
          />
        )}

        {r.podcasts.length > 0 && (
          <MusicShelf
            title={getString('search_section_podcasts')}
            onSeeAll={() => setFilterType('podcasts')}
            items={r.podcasts}
            renderItem={(p) => <MusicItemCard variant="podcast" item={p} />}
          />
        )}

        {r.episodes.length > 0 && (
          <MusicShelf
            title={getString('search_section_episodes')}
            onSeeAll={() => setFilterType('episodes')}
            items={r.episodes}
            renderItem={(e) => <MusicItemCard variant="episode" item={e} />}
          />
        )}
      </div>
    );
  }

  // ========================================================================
  // FILTERED — dense, paginated single-model views
  // ========================================================================
  return (
    <div className="pb-12">
      {filterType === 'videos' && (
        <>
          <VideoGrid videos={r.videos} onPlay={onPlayVideo} onAddToQueue={onAddToQueue} />
          {sentinel}
        </>
      )}

      {filterType === 'live' && (
        <>
          <VideoGrid videos={r.live} onPlay={onPlayVideo} onAddToQueue={onAddToQueue} />
          {sentinel}
        </>
      )}

      {filterType === 'songs' && (
        <>
          <div className="flex flex-col gap-0.5">
            {visibleSongs.map((song) => (
              <MusicItemCard
                key={song.id}
                variant="track-list"
                item={song}
                onPlay={() => playSong(song, visibleSongs)}
                onMenu={() => addSongToQueue(song)}
              />
            ))}
          </div>
          {sentinel}
        </>
      )}

      {filterType === 'albums' && (
        <>
          <div className={RESULT_GRID} style={squareGridStyle}>
            {r.albums.map((a) => (
              <MusicItemCard key={a.browseId} variant="album" item={a} fill onPlay={() => openAlbum(a)} onOpen={() => openAlbum(a)} />
            ))}
          </div>
          {sentinel}
        </>
      )}

      {filterType === 'playlists' && (
        <>
          <div className={RESULT_GRID} style={wideGridStyle}>
            {r.playlists.map((p) => (
              <PlaylistCard key={p.id} playlist={toPlaylistSummary(p)} onClick={() => openPlaylist(p)} />
            ))}
          </div>
          {sentinel}
        </>
      )}

      {filterType === 'podcasts' && (
        <>
          <div className={RESULT_GRID} style={squareGridStyle}>
            {r.podcasts.map((p) => (
              <MusicItemCard key={p.id} variant="podcast" item={p} fill />
            ))}
          </div>
          {sentinel}
        </>
      )}

      {filterType === 'episodes' && (
        <>
          <div className={RESULT_GRID} style={squareGridStyle}>
            {r.episodes.map((e) => (
              <MusicItemCard key={e.id} variant="episode" item={e} fill />
            ))}
          </div>
          {sentinel}
        </>
      )}

      {filterType === 'artists' && (
        <>
          <div className={RESULT_GRID} style={squareGridStyle}>
            {r.artists.map((a) => (
              <ArtistCard key={a.id} artist={a} fill onOpen={() => openArtist(a)} />
            ))}
            {r.channels.map((c) => (
              <ChannelCard
                key={c.id}
                fill
                channelId={c.channelId ?? c.id}
                name={c.title}
                avatarUrl={c.channelAvatarUrl ?? c.thumbnailUrl}
                subtitle={c.publishedText}
              />
            ))}
          </div>
          {sentinel}
        </>
      )}
    </div>
  );
}

// --- sub-components --------------------------------------------------------

function ShelfHeader({
  title,
  onSeeAll,
  seeAllLabel,
}: {
  title: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between px-1">
      <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{title}</h2>
      {onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="text-sm font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
        >
          {seeAllLabel ?? getString('music_show_all')}
        </button>
      )}
    </div>
  );
}

function TopResultHero({
  top,
  onPlaySong,
  onPlayVideo,
  onOpenAlbum,
  onOpenArtist,
  onOpenChannel,
}: {
  top: TopResult;
  onPlaySong: (s: SongItem, ctx: SongItem[]) => void;
  onPlayVideo: (v: VideoSummary) => void;
  onOpenAlbum: (a: AlbumItem) => void;
  onOpenArtist: (a: ArtistItem) => void;
  onOpenChannel: (v: VideoSummary) => void;
}) {
  const circle = top.kind === 'artist' || top.kind === 'channel';

  let thumb: string | null | undefined;
  let title = '';
  let subtitle = '';
  let actionLabel = getString('search_action_open');
  let isPlay = false;
  let action = () => {};

  switch (top.kind) {
    case 'song':
      thumb = top.item.thumbnail;
      title = top.item.title;
      subtitle = artistsText(top.item.artists);
      actionLabel = getString('search_action_play');
      isPlay = true;
      action = () => onPlaySong(top.item, [top.item]);
      break;
    case 'video':
      thumb = top.item.thumbnailUrl;
      title = top.item.title;
      subtitle = top.item.channelName;
      actionLabel = getString('search_action_play');
      isPlay = true;
      action = () => onPlayVideo(top.item);
      break;
    case 'album':
      thumb = top.item.thumbnail;
      title = top.item.title;
      subtitle = artistsText(top.item.artists) || (top.item.year ? String(top.item.year) : '');
      action = () => onOpenAlbum(top.item);
      break;
    case 'artist':
      thumb = top.item.thumbnail;
      title = top.item.title;
      subtitle = getString('search_role_artist');
      action = () => onOpenArtist(top.item);
      break;
    case 'channel':
      thumb = top.item.channelAvatarUrl ?? top.item.thumbnailUrl;
      title = top.item.title;
      subtitle = top.item.publishedText || getString('search_role_channel');
      actionLabel = getString('search_action_view_channel');
      action = () => onOpenChannel(top.item);
      break;
  }

  const displayThumb = useProxiedImageUrl(circle ? upgradeAvatarUrl(thumb) : upgradeMusicImageUrl(thumb));

  return (
    <section className="flex flex-col">
      <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
        {getString('search_top_result')}
      </p>
      <div
        role="button"
        tabIndex={0}
        onClick={action}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            action();
          }
        }}
        className="group flex cursor-pointer items-center gap-5 rounded-2xl border border-chrome-neutral-800/50 bg-surface-container-low p-5 outline-none transition-colors duration-200 ease-out hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <div className={cx('h-28 w-28 shrink-0 overflow-hidden ring-1 ring-chrome-neutral-800/50', circle ? 'rounded-full' : 'rounded-xl')}>
          {displayThumb ? (
            <img src={displayThumb} alt={title} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-surface-container-high text-chrome-neutral-600">
              <SearchIcon className="h-8 w-8" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="line-clamp-2 text-2xl font-bold tracking-tight text-chrome-neutral-100">{title}</h2>
          {subtitle && <span className="line-clamp-1 text-sm text-chrome-neutral-400">{subtitle}</span>}
          <Button
            variant="primary"
            size="sm"
            className="mt-2 w-fit"
            onClick={(e) => {
              e.stopPropagation();
              action();
            }}
          >
            {isPlay && <Play className="h-4 w-4" fill="currentColor" />}
            {actionLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}

// --- skeletons (shimmer) ---------------------------------------------------

function ShimmerBlock({ className }: { className?: string }) {
  return <div className={cx('shimmer bg-surface-container-low', className)} />;
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-2">
          <ShimmerBlock className="h-12 w-12 shrink-0 rounded-md" />
          <div className="flex flex-1 flex-col gap-2">
            <ShimmerBlock className="h-3.5 w-1/3 rounded" />
            <ShimmerBlock className="h-3 w-1/4 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonCardGrid({ shape, count }: { shape: 'square' | 'circle' | 'video'; count: number }) {
  const gridStyle = useGridStyle({ density: shape === 'video' ? 'video' : 'dense' });
  const media =
    shape === 'video'
      ? 'aspect-video rounded-xl'
      : shape === 'circle'
        ? 'aspect-square rounded-full'
        : 'aspect-square rounded-xl';
  return (
    <div className={RESULT_GRID} style={gridStyle}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cx('flex flex-col gap-3', shape === 'circle' && 'items-center')}>
          <ShimmerBlock className={cx('w-full', media)} />
          <ShimmerBlock className="h-3.5 w-3/4 rounded" />
          <ShimmerBlock className="h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}

function ResultsSkeleton({ filterType }: { filterType: SearchCategory }) {
  switch (filterType) {
    case 'songs':
    case 'episodes':
      return <SkeletonRows count={10} />;
    case 'videos':
    case 'live':
      return <SkeletonCardGrid shape="video" count={12} />;
    case 'playlists':
      return <SkeletonCardGrid shape="video" count={8} />;
    case 'albums':
    case 'podcasts':
      return <SkeletonCardGrid shape="square" count={12} />;
    case 'artists':
      return <SkeletonCardGrid shape="circle" count={12} />;
    case 'all':
    default:
      return (
        <div className="flex flex-col gap-10">
          <div className="flex items-center gap-5 rounded-2xl border border-chrome-neutral-800/50 bg-surface-container-low p-5">
            <ShimmerBlock className="h-28 w-28 shrink-0 rounded-xl" />
            <div className="flex flex-1 flex-col gap-3">
              <ShimmerBlock className="h-6 w-1/2 rounded" />
              <ShimmerBlock className="h-3.5 w-1/3 rounded" />
              <ShimmerBlock className="h-9 w-28 rounded-full" />
            </div>
          </div>
          <SkeletonRows count={4} />
          <SkeletonCardGrid shape="video" count={4} />
        </div>
      );
  }
}

function EmptyState({
  title,
  body,
  tone = 'default',
}: {
  title: string;
  body: string;
  tone?: 'default' | 'error';
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 py-24 text-center">
      <SearchIcon className={cx('mb-4', tone === 'error' ? 'text-chrome-red-400/60' : 'text-chrome-neutral-700')} size={48} />
      <h3 className="font-semibold text-chrome-neutral-200">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">{body}</p>
    </div>
  );
}

export default SearchResults;
