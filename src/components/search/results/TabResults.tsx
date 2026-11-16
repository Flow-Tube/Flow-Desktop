import type { Ref } from 'react';
import { MusicItemCard } from '../../music/MusicItemCard';
import { MusicShelf } from '../../music/MusicShelf';
import { ArtistCard } from '../../music/ArtistCard';
import { PlaylistCard } from '../../video/PlaylistCard';
import { ChannelShortsGrid } from '../../channel/ChannelGrids';
import { SearchCorrectionLine } from '../SearchCorrectionLine';
import { SearchCreatorCard } from '../SearchCreatorCard';
import { getString } from '../../../lib/i18n/index';
import { VIDEO_FILTER_CATEGORIES } from '../../../lib/searchFilterState';
import { useGridStyle } from '../../../lib/useGridColumns';
import type { UseCombinedSearchReturn } from '../../../lib/useCombinedSearch';
import type { VisibleSearchResults } from '../../../lib/useVisibleSearchResults';
import type { SearchChannel, VideoSummary } from '../../../types/video';
import { LoadMore, RESULT_GRID, SearchChannelCard, ShelfHeader, toPlaylistSummary } from './ResultParts';
import { VideoResults, type SearchLayout } from './VideoResults';
import type { ResultActions } from './useResultActions';

interface TabResultsProps {
  search: UseCombinedSearchReturn;
  visible: VisibleSearchResults;
  actions: ResultActions;
  sentinelRef: Ref<HTMLDivElement>;
  layout: SearchLayout;
  onPlayVideo: (v: VideoSummary) => void;
  onAddToQueue: (v: VideoSummary) => void;
}

/** One kind of result, paged as you scroll. */
export function TabResults({ search, visible, actions, sentinelRef, layout, onPlayVideo, onAddToQueue }: TabResultsProps) {
  const squareGridStyle = useGridStyle({ density: 'dense' });
  const wideGridStyle = useGridStyle();
  const { creator, results: r } = visible;
  const { filterType } = search;
  const more = (
    <LoadMore sentinelRef={sentinelRef} loading={search.isFetchingNextPage} failed={Boolean(search.error)} onRetry={search.fetchNextPage} />
  );

  return (
    <div className="pb-12">
      {VIDEO_FILTER_CATEGORIES.has(filterType) && (
        <SearchCorrectionLine correction={r.correction} exact={search.exact} onSearchExactly={search.searchExactly} />
      )}

      {filterType === 'shorts' && (
        <>
          <ChannelShortsGrid shorts={r.shorts} />
          {more}
        </>
      )}

      {(filterType === 'videos' || filterType === 'movies') && (
        <div className="flex flex-col gap-8">
          {creator && <SearchCreatorCard creator={creator} onPlay={onPlayVideo} onAddToQueue={onAddToQueue} />}
          {r.channels.length > 0 && (
            <MusicShelf<SearchChannel>
              title={getString('search_section_channels')}
              skeletonShape="circle"
              items={r.channels}
              renderItem={(c) => <SearchChannelCard channel={c} />}
            />
          )}
          <VideoResults
            videos={r.videos}
            order={search.results.videos.map((video) => video.id)}
            shelves={r.shelves}
            shortsShelves={r.shortsShelves}
            postShelves={r.postShelves}
            layout={layout}
            query={search.query}
            onPlay={onPlayVideo}
            onAddToQueue={onAddToQueue}
          />
          {more}
        </div>
      )}

      {filterType === 'live' && (
        <>
          <VideoResults
            videos={r.live}
            order={search.results.live.map((video) => video.id)}
            layout={layout}
            query={search.query}
            onPlay={onPlayVideo}
            onAddToQueue={onAddToQueue}
          />
          {more}
        </>
      )}

      {filterType === 'songs' && (
        <>
          <div role="list" className="flex flex-col gap-0.5">
            <div aria-hidden="true" className="mb-1 flex items-center gap-4 border-b border-outline-variant px-2 pb-2 text-xs font-semibold text-chrome-neutral-500">
              <span className="w-6 shrink-0 text-center">#</span>
              <span className="w-12 shrink-0" />
              <span className="flex-1">{getString('search_songs_col_title')}</span>
              <span className="hidden w-[28%] shrink-0 md:block">{getString('search_songs_col_album')}</span>
              <span className="w-24 shrink-0 text-end">{getString('search_songs_col_time')}</span>
            </div>
            {r.songs.map((song, index) => (
              <div role="listitem" key={song.id}>
                <MusicItemCard variant="track-list" item={song} position={index + 1} showAlbum onPlay={() => actions.playSong(song)} />
              </div>
            ))}
          </div>
          {more}
        </>
      )}

      {filterType === 'albums' && (
        <>
          <div className={RESULT_GRID} style={squareGridStyle}>
            {r.albums.map((a) => (
              <MusicItemCard key={a.browseId} variant="album" item={a} fill onPlay={() => actions.openAlbum(a)} onOpen={() => actions.openAlbum(a)} />
            ))}
          </div>
          {more}
        </>
      )}

      {filterType === 'playlists' && (
        <div className="flex flex-col gap-8">
          {r.videoPlaylists.length > 0 && (
            <section className="flex flex-col">
              <ShelfHeader title={getString('search_section_youtube_playlists')} />
              <div className={RESULT_GRID} style={wideGridStyle}>
                {r.videoPlaylists.map((p) => (
                  <PlaylistCard key={p.id} playlist={p} onClick={() => actions.openVideoPlaylist(p.id)} />
                ))}
              </div>
            </section>
          )}
          {r.playlists.length > 0 && (
            <section className="flex flex-col">
              {r.videoPlaylists.length > 0 && <ShelfHeader title={getString('search_section_music_playlists')} />}
              <div className={RESULT_GRID} style={wideGridStyle}>
                {r.playlists.map((p) => (
                  <PlaylistCard key={p.id} playlist={toPlaylistSummary(p)} onClick={() => actions.openPlaylist(p)} />
                ))}
              </div>
            </section>
          )}
          {more}
        </div>
      )}

      {filterType === 'podcasts' && (
        <>
          <div className={RESULT_GRID} style={squareGridStyle}>
            {r.podcasts.map((p) => (
              <MusicItemCard key={p.id} variant="podcast" item={p} fill onOpen={() => actions.openPodcast(p)} onPlay={() => actions.openPodcast(p)} />
            ))}
          </div>
          {more}
        </>
      )}

      {filterType === 'episodes' && (
        <>
          <div className={RESULT_GRID} style={squareGridStyle}>
            {r.episodes.map((e) => (
              <MusicItemCard key={e.id} variant="episode" item={e} fill onPlay={() => actions.playEpisode(e, r.episodes)} />
            ))}
          </div>
          {more}
        </>
      )}

      {filterType === 'artists' && (
        <>
          <div className={RESULT_GRID} style={squareGridStyle}>
            {r.artists.map((a) => (
              <ArtistCard key={a.id} artist={a} fill onOpen={() => actions.openArtist(a)} />
            ))}
            {r.channels.map((c) => (
              <SearchChannelCard key={c.channelId} channel={c} fill />
            ))}
          </div>
          {more}
        </>
      )}
    </div>
  );
}
