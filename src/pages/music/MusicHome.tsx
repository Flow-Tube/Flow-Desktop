import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { CategoryChips } from '../../components/layout/CategoryChips';
import { MusicItemCard } from '../../components/music/MusicItemCard';
import { MusicShelf } from '../../components/music/MusicShelf';
import { useMusicChipFilter, useMusicHome } from '../../lib/useMusicHome';
import { useMusicPersonalization } from '../../lib/useMusicPersonalization';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { useMusicArtistHidden, useMusicHiddenFilter } from '../../store/useMusicActionsStore';
import { getString } from '../../lib/i18n/index';
import { useGridStyle } from '../../lib/useGridColumns';
import type { AlbumItem, ArtistItem, PlaylistItem, SongItem, YTItem } from '../../types/music';

const songsOf = (items: YTItem[]): SongItem[] =>
  items.filter((i): i is Extract<YTItem, { type: 'song' }> => i.type === 'song');

const renderable = (item: YTItem) => item.type !== 'episode' && item.type !== 'podcast';

function SquareSkeleton({ fill }: { fill?: boolean }) {
  return (
    <div className={`flex shrink-0 animate-pulse flex-col gap-3 ${fill ? 'w-full' : 'w-40 md:w-48 lg:w-56'}`}>
      <div className="aspect-square w-full rounded-xl bg-surface-container-low" />
      <div className="h-3.5 w-3/4 rounded bg-surface-container-low" />
      <div className="h-3 w-1/2 rounded bg-surface-container-low" />
    </div>
  );
}

export default function MusicHome() {
  const gridStyle = useGridStyle({ density: 'dense' });
  const navigate = useNavigate();
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const addToQueue = useMusicPlayerStore((s) => s.addToQueue);
  const { data, loading, error, reload, loadMore, hasMore, loadingMore } = useMusicHome();
  const personalization = useMusicPersonalization();
  const isHidden = useMusicHiddenFilter();
  const isArtistHidden = useMusicArtistHidden();
  // Drop blocked/dismissed songs and blocked-artist cards from every shelf.
  const visible = (items: YTItem[]): YTItem[] =>
    items.filter((it) =>
      it.type === 'song' ? !isHidden(it) : it.type === 'artist' ? !isArtistHidden(it) : true,
    );

  const fallbackMoods = useMemo(
    () => [
      getString('music_mood_all'),
      getString('music_mood_workout'),
      getString('music_mood_focus'),
      getString('music_mood_relax'),
      getString('music_mood_podcasts'),
    ],
    [],
  );

  const chips = data?.chips ?? [];
  const categories = chips.length
    ? [getString('music_mood_all'), ...chips.map((c) => c.title).filter(Boolean)]
    : fallbackMoods;
  const [activeMood, setActiveMood] = useState<string>(getString('music_mood_all'));
  const activeChip = useMemo(
    () => chips.find((c) => c.title === activeMood) ?? null,
    [chips, activeMood],
  );
  const chipFilter = useMusicChipFilter(activeChip);

  const isFiltering = !!activeChip;
  const pageHasMore = isFiltering ? chipFilter.hasMore : hasMore;
  const pageLoadingMore = isFiltering ? chipFilter.loadingMore : loadingMore;
  const pageLoadMore = isFiltering ? chipFilter.loadMore : loadMore;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pageHasMore || pageLoadingMore || typeof IntersectionObserver === 'undefined') return;
    const target = sentinelRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void pageLoadMore();
      },
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [pageHasMore, pageLoadingMore, pageLoadMore]);

  const playTrack = (track: SongItem, context: SongItem[]) => {
    const queue = context.length ? context : [track];
    const id = track.videoId ?? track.id;
    const startIndex = Math.max(0, queue.findIndex((t) => (t.videoId ?? t.id) === id));
    void playQueue(queue, startIndex);
  };

  const openAlbum = (a: AlbumItem) => navigate(`/music/album/${a.browseId}`);
  const openArtist = (a: ArtistItem) => navigate(`/music/artist/${a.id}`);
  const openPlaylist = (p: PlaylistItem) => navigate(`/music/playlist/${p.id}`);

  const renderCard = (item: YTItem, songContext: SongItem[], fill = false) => {
    switch (item.type) {
      case 'song':
        return <MusicItemCard variant="song" item={item} fill={fill} onPlay={() => playTrack(item, songContext)} />;
      case 'album':
        return (
          <MusicItemCard variant="album" item={item} fill={fill} onPlay={() => openAlbum(item)} onOpen={() => openAlbum(item)} />
        );
      case 'playlist':
        return (
          <MusicItemCard
            variant="playlist"
            item={item}
            fill={fill}
            onPlay={() => openPlaylist(item)}
            onOpen={() => openPlaylist(item)}
          />
        );
      case 'artist':
        return <MusicItemCard variant="artist" item={item} fill={fill} onOpen={() => openArtist(item)} />;
      default:
        return null;
    }
  };

  const renderBody = () => {
    if (error && !data) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <AlertTriangle className="h-8 w-8 text-chrome-neutral-500" />
          <p className="text-sm text-chrome-neutral-400">{getString('music_error_generic')}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-full bg-surface-container-high px-4 py-2 text-sm font-medium text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest"
          >
            {getString('music_retry')}
          </button>
        </div>
      );
    }

    if (activeChip) {
      const items = visible(chipFilter.items.filter(renderable));
      const songContext = songsOf(items);
      return (
        <div className="flow-grid gap-y-6" style={gridStyle}>
          {chipFilter.loading && items.length === 0
            ? Array.from({ length: 18 }).map((_, i) => <SquareSkeleton key={i} fill />)
            : items.map((item, i) => <div key={i}>{renderCard(item, songContext, true)}</div>)}
        </div>
      );
    }

    if (loading && !data) {
      return (
        <div className="flex flex-col gap-10">
          {Array.from({ length: 5 }).map((_, i) => (
            <MusicShelf key={i} title="" items={[]} loading skeletonShape="square" renderItem={() => null} />
          ))}
        </div>
      );
    }

    const quickPicks = (
      personalization.quickPicks.length ? personalization.quickPicks : data?.quickPicks ?? []
    ).filter((track) => !isHidden(track));
    const personalSections = personalization.sections;
    const seenTitles = new Set(personalSections.map((s) => s.title.trim().toLowerCase()));
    const homeSections = (data?.sections ?? []).filter(
      (s) => !seenTitles.has(s.title.trim().toLowerCase()),
    );

    const renderShelf = (key: string, title: string, rawItems: YTItem[]) => {
      const items = visible(rawItems.filter(renderable)).slice(0, 20);
      if (items.length === 0) return null;
      const songContext = songsOf(items);
      const shape = items[0]?.type === 'artist' ? 'circle' : 'square';
      return (
        <MusicShelf
          key={key}
          title={title}
          items={items}
          skeletonShape={shape}
          renderItem={(item) => renderCard(item, songContext)}
        />
      );
    };

    return (
      <>
        {quickPicks.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 px-1 text-xl font-bold tracking-tight text-chrome-neutral-100">
              {getString('music_quick_picks')}
            </h2>
            <div className="grid auto-cols-[88%] grid-flow-col grid-rows-3 gap-x-4 gap-y-1 overflow-x-auto hide-scrollbar snap-x pb-4 sm:auto-cols-[46%] lg:auto-cols-[31%] xl:auto-cols-[23.5%]">
              {quickPicks.map((track) => (
                <MusicItemCard
                  key={track.videoId ?? track.id}
                  variant="track-list"
                  item={track}
                  className="snap-start bg-surface-container-low pr-3"
                  onPlay={() => playTrack(track, quickPicks)}
                  onMenu={() => addToQueue(track)}
                />
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-col gap-10">
          {personalSections.map((section) =>
            renderShelf(
              section.id,
              section.subtitle ? `${section.subtitle} ${section.title}` : section.title,
              section.items,
            ),
          )}
          {homeSections.map((section, idx) =>
            renderShelf(`${section.title}-${idx}`, section.title, section.items),
          )}
        </div>
      </>
    );
  };

  return (
    <div className="px-6 py-6 lg:px-8">
      <CategoryChips
        categories={categories}
        activeCategory={activeMood}
        onCategoryChange={setActiveMood}
        sticky={false}
        className="mt-1 mb-8"
      />
      {renderBody()}

      {!error && pageHasMore && (
        <div className="flex flex-col items-center gap-3 py-10">
          <div ref={sentinelRef} className="h-px w-full" />
          <button
            type="button"
            onClick={() => void pageLoadMore()}
            disabled={pageLoadingMore}
            className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-5 py-2.5 text-sm font-medium text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest disabled:opacity-50"
          >
            {pageLoadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {getString('music_load_more')}
          </button>
        </div>
      )}
    </div>
  );
}
