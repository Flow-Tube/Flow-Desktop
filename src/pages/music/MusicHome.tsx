import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { CategoryChips } from '../../components/layout/CategoryChips';
import { MusicItemCard } from '../../components/music/MusicItemCard';
import { CommunityPlaylistCard } from '../../components/music/CommunityPlaylistCard';
import { MusicMoodShelf } from '../../components/music/MusicMoodShelf';
import { MusicQuickPicksShelf } from '../../components/music/MusicQuickPicksShelf';
import { MusicShelf } from '../../components/music/MusicShelf';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useMusicChipFilter, useMusicHome } from '../../lib/useMusicHome';
import { useMusicPersonalization } from '../../lib/useMusicPersonalization';
import { useMusicDiscoverySections } from '../../lib/useMusicDiscoverySections';
import { useMusicCharts } from '../../lib/useMusicCharts';
import { useMusicMoods } from '../../lib/useMusicMoods';
import { composeMusicFeed, type MusicFeedSection } from '../../lib/musicFeedComposer';
import { musicSeeAllRoute } from '../../lib/musicRoutes';
import { usePreference } from '../../lib/usePreference';
import { SETTINGS } from '../../lib/settings/schema';
import { REGION_OPTIONS } from '../../lib/regionOptions';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { useMusicArtistHidden, useMusicHiddenFilter } from '../../store/useMusicActionsStore';
import { getString } from '../../lib/i18n/index';
import { useGridStyle } from '../../lib/useGridColumns';
import type { AlbumItem, ArtistItem, MoodAndGenreItem, PlaylistItem, SongItem, YTItem } from '../../types/music';

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
  const { t } = useTranslation('common');
  const gridStyle = useGridStyle({ density: 'dense' });
  const navigate = useNavigate();
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const addToQueue = useMusicPlayerStore((s) => s.addToQueue);
  const { data, loading, error, reload, loadMore, hasMore, loadingMore, loadMoreError } = useMusicHome();
  const personalization = useMusicPersonalization();
  const discoverySections = useMusicDiscoverySections();
  const [chartCountry, setChartCountry] = usePreference(SETTINGS.TRENDING_REGION, 'US');
  const charts = useMusicCharts(chartCountry);
  const moods = useMusicMoods();
  const isHidden = useMusicHiddenFilter();
  const isArtistHidden = useMusicArtistHidden();
  // Drop blocked/dismissed songs and blocked-artist cards from every shelf.
  const visible = (items: YTItem[]): YTItem[] =>
    items.filter((it) =>
      it.type === 'song' ? !isHidden(it) : it.type === 'artist' ? !isArtistHidden(it) : true,
    );

  const chips = (data?.chips ?? []).filter((chip) => !!chip.browseId);
  const categories = [getString('music_mood_all'), ...chips.map((chip) => chip.title).filter(Boolean)];
  const [activeMood, setActiveMood] = useState<string>(getString('music_mood_all'));
  const activeChip = useMemo(
    () => chips.find((c) => c.title === activeMood) ?? null,
    [chips, activeMood],
  );
  useEffect(() => {
    if (activeMood !== getString('music_mood_all') && !chips.some((chip) => chip.title === activeMood)) {
      setActiveMood(getString('music_mood_all'));
    }
  }, [activeMood, chips]);
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

  const playTrack = (track: SongItem, context: SongItem[], source: string | null) => {
    const queue = context.length ? context : [track];
    const id = track.videoId ?? track.id;
    const startIndex = Math.max(0, queue.findIndex((t) => (t.videoId ?? t.id) === id));
    void playQueue(queue, startIndex, source);
  };

  const openAlbum = (a: AlbumItem) => navigate(`/music/album/${a.browseId}`);
  const openArtist = (a: ArtistItem) => navigate(`/music/artist/${a.id}`);
  const openPlaylist = (p: PlaylistItem) => navigate(`/music/playlist/${p.id}`);
  const moodItems = moods.groups.flatMap((group) => group.items).slice(0, 16);
  const openMood = (mood: MoodAndGenreItem) =>
    navigate(musicSeeAllRoute(mood.browseId, mood.params, mood.title));

  const renderCard = (item: YTItem, songContext: SongItem[], source: string | null, fill = false) => {
    switch (item.type) {
      case 'song':
        return item.musicVideoType && item.musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV'
          ? <MusicItemCard variant="video" item={item} fill={fill}
              onPlay={() => navigate(`/watch/${item.videoId ?? item.id}`)}
              onOpen={() => navigate(`/watch/${item.videoId ?? item.id}`)} />
          : <MusicItemCard variant="song" item={item} fill={fill} onPlay={() => playTrack(item, songContext, source)} />;
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
    const hasLocal = personalization.quickPicks.length > 0 || personalization.sections.length > 0
      || discoverySections.length > 0;
    if (error && !data && !hasLocal) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <AlertTriangle className="h-8 w-8 text-chrome-neutral-500" />
          <p className="text-sm text-chrome-neutral-400">{getString('music_error_generic')}</p>
          <Button variant="secondary" onClick={() => void reload()}>
            {getString('music_retry')}
          </Button>
        </div>
      );
    }

    if (activeChip) {
      const items = visible(chipFilter.items.filter(renderable));
      const songContext = songsOf(items);
      if (chipFilter.error && items.length === 0) {
        return <div className="flex flex-col items-center gap-3 py-20 text-center">
          <p className="text-sm text-chrome-neutral-400">{getString('music_error_generic')}</p>
          <Button variant="secondary" onClick={chipFilter.reload}>{getString('music_retry')}</Button>
        </div>;
      }
      if (!chipFilter.loading && items.length === 0) {
        return <p className="py-20 text-center text-sm text-chrome-neutral-400">{t('musicChipEmpty')}</p>;
      }
      return (
        <div className="flow-grid gap-y-6" style={gridStyle}>
          {chipFilter.loading && items.length === 0
            ? Array.from({ length: 18 }).map((_, i) => <SquareSkeleton key={i} fill />)
            : items.map((item, i) => <div key={i}>{renderCard(item, songContext, activeChip.title, true)}</div>)}
        </div>
      );
    }

    if (loading && !data && !hasLocal) {
      return (
        <div className="flex flex-col gap-10">
          {Array.from({ length: 5 }).map((_, i) => (
            <MusicShelf key={i} title="" items={[]} loading skeletonShape="square" renderItem={() => null} />
          ))}
        </div>
      );
    }

    const quickPicks = personalization.quickPicks.filter((track) => !isHidden(track));
    const personalSections = [
      ...personalization.sections.filter((section) => section.id === 'on-repeat'),
      ...discoverySections,
      ...personalization.sections.filter((section) => section.id !== 'on-repeat'),
    ];
    const feedSections = composeMusicFeed(
      personalSections.map((section) => ({ ...section, items: visible(section.items) })),
      [...(data?.sections ?? []), ...charts].map((section) => ({ ...section, items: visible(section.items) })),
      personalization.maturity, quickPicks,
    );

    const seeAll = (section: MusicFeedSection, items: YTItem[]) => {
      if (section.route) return () => navigate(section.route as string);
      if (section.browseId) {
        const route = musicSeeAllRoute(section.browseId, section.params, section.title, items);
        return () => navigate(route);
      }
      return undefined;
    };

    const renderShelf = (section: MusicFeedSection) => {
      const items = visible(section.items.filter(renderable)).slice(0, 20);
      if (items.length === 0) return null;
      const songContext = songsOf(items);
      const shape = items[0]?.type === 'artist' ? 'circle' : 'square';
      return (
        <MusicShelf
          title={section.title}
          subtitle={section.subtitle}
          items={items}
          onSeeAll={seeAll(section, items)}
          skeletonShape={shape}
          renderItem={(item) => {
            const preview = item.type === 'playlist'
              ? (section.previews?.[item.id] ?? []).filter((track) => !isHidden(track)) : [];
            return item.type === 'playlist' && preview.length > 0
              ? <CommunityPlaylistCard playlist={item} preview={preview}
                  onOpen={() => openPlaylist(item)}
                  onPlayPreview={(track) => playTrack(track, preview, item.title)} />
              : renderCard(item, songContext, section.title);
          }}
        />
      );
    };

    if (!quickPicks.length && !feedSections.length && !loading && !moodItems.length) {
      return <p className="py-20 text-center text-sm text-chrome-neutral-400">{t('musicEmpty')}</p>;
    }
    const quickTitle = getString('music_quick_picks');
    const quickShelf = (
      <MusicQuickPicksShelf
        key="quick-picks"
        title={quickTitle}
        tracks={quickPicks}
        onPlay={(track) => playTrack(track, quickPicks, quickTitle)}
        onQueue={addToQueue}
      />
    );
    const moodShelf = (
      <MusicMoodShelf
        key="moods"
        title={t('musicMoodsAndGenres')}
        moods={moodItems}
        onOpen={openMood}
        onSeeAll={() => navigate('/music/moods')}
      />
    );
    // A first-run home leads with charts/releases, then Quick Picks and moods; a warm one
    // leads with Quick Picks and personal shelves, with moods before the generic feed.
    const cold = personalization.maturity === 'cold_start';
    const leadCount = cold
      ? feedSections.filter((section) => section.origin === 'anchor').length
      : 0;
    const firstGeneric = feedSections.findIndex((section) => section.origin !== 'personal');
    const moodIndex = cold ? leadCount : firstGeneric === -1 ? feedSections.length : firstGeneric;
    const rows: React.ReactNode[] = feedSections.map((section) => (
      <div key={section.id}>{renderShelf(section)}</div>
    ));
    rows.splice(moodIndex, 0, moodShelf);
    rows.splice(leadCount, 0, quickShelf);
    return <div className="flex flex-col gap-10">{rows}</div>;
  };

  return (
    <div className="px-6 py-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => navigate('/music/moods')}>{t('musicBrowse')}</Button>
        <div className="flex items-center gap-2">
          <span className="text-sm text-chrome-neutral-400">{t('musicChartCountry')}</span>
          <Select value={chartCountry} onChange={setChartCountry} options={REGION_OPTIONS} />
        </div>
      </div>
      <CategoryChips
        categories={categories}
        activeCategory={activeMood}
        onCategoryChange={setActiveMood}
        sticky={false}
        className="mt-1 mb-8"
      />
      {renderBody()}

      {error && (data || personalization.quickPicks.length || personalization.sections.length
        || discoverySections.length) && (
        <div className="mt-5 flex items-center gap-3 text-sm text-chrome-neutral-400">
          <span>{getString('music_error_generic')}</span>
          <Button variant="secondary" onClick={() => void reload()}>{getString('music_retry')}</Button>
        </div>
      )}
      {loadMoreError && <p className="text-center text-sm text-chrome-neutral-400">{loadMoreError}</p>}

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
