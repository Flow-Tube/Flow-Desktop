import { VideoGrid } from '../../video/VideoGrid';
import { MusicItemCard } from '../../music/MusicItemCard';
import { MusicShelf } from '../../music/MusicShelf';
import { ArtistCard } from '../../music/ArtistCard';
import { PlaylistCard } from '../../video/PlaylistCard';
import { ShortsShelf } from '../../shelf/ShortsShelf';
import { PostShelf } from '../../shelf/PostShelf';
import { SearchCorrectionLine } from '../SearchCorrectionLine';
import { SearchCreatorCard } from '../SearchCreatorCard';
import { getString } from '../../../lib/i18n/index';
import type { UseCombinedSearchReturn } from '../../../lib/useCombinedSearch';
import type { VisibleSearchResults } from '../../../lib/useVisibleSearchResults';
import type { AlbumItem, ArtistItem, PlaylistItem } from '../../../types/music';
import type { SearchChannel, VideoSummary } from '../../../types/video';
import { SearchChannelCard, ShelfHeader, VideoShelves, toPlaylistSummary } from './ResultParts';
import { TopResultHero } from './TopResultHero';
import type { ResultActions } from './useResultActions';

type ArtistOrChannel = { kind: 'artist'; item: ArtistItem } | { kind: 'channel'; item: SearchChannel };

interface AllResultsProps {
  search: UseCombinedSearchReturn;
  visible: VisibleSearchResults;
  actions: ResultActions;
  onPlayVideo: (v: VideoSummary) => void;
  onAddToQueue: (v: VideoSummary) => void;
}

/** One bounded shelf per kind of result, each leading to its own tab. */
export function AllResults({ search, visible, actions, onPlayVideo, onAddToQueue }: AllResultsProps) {
  const { creator, results: r } = visible;
  const { setFilterType } = search;
  const artistsChannels: ArtistOrChannel[] = [
    ...r.artists.map((item): ArtistOrChannel => ({ kind: 'artist', item })),
    ...r.channels.map((item): ArtistOrChannel => ({ kind: 'channel', item })),
  ];

  return (
    <div className="flex flex-col gap-10 pb-12">
      <SearchCorrectionLine correction={r.correction} exact={search.exact} onSearchExactly={search.searchExactly} />
      {(r.topResult || r.songs.length > 0) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          {r.topResult && (
            <section className={r.songs.length > 0 ? 'flex flex-col' : 'flex flex-col lg:col-span-2 lg:max-w-xl'}>
              <ShelfHeader title={getString('search_top_result')} />
              <TopResultHero top={r.topResult} actions={actions} onPlayVideo={onPlayVideo} />
            </section>
          )}
          {r.songs.length > 0 && (
            <section className={r.topResult ? 'flex min-w-0 flex-col' : 'flex min-w-0 flex-col lg:col-span-2'}>
              <ShelfHeader
                title={getString('search_section_songs')}
                onSeeAll={() => setFilterType('songs')}
                seeAllLabel={getString('search_see_all_songs')}
              />
              <div className="flex flex-col gap-1">
                {r.songs.slice(0, 4).map((song) => (
                  <MusicItemCard key={song.id} variant="track-list" item={song} onPlay={() => actions.playSong(song)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {creator && <SearchCreatorCard creator={creator} onPlay={onPlayVideo} onAddToQueue={onAddToQueue} />}

      {r.videos.length > 0 && (
        <section className="flex flex-col">
          <ShelfHeader
            title={getString('search_section_videos')}
            onSeeAll={() => setFilterType('videos')}
            seeAllLabel={getString('search_see_all_videos')}
          />
          <VideoGrid videos={r.videos} rows={1} onPlay={onPlayVideo} onAddToQueue={onAddToQueue} />
        </section>
      )}

      <ShortsShelf title={getString('search_section_shorts')} shorts={r.shorts} onPlay={onPlayVideo} />

      {r.postShelves.map((shelf, index) => (
        <PostShelf key={`posts:${shelf.posts[0]?.id ?? index}`} title={shelf.title ?? getString('search_section_posts')} posts={shelf.posts} />
      ))}

      <VideoShelves shelves={r.shelves} onPlay={onPlayVideo} onAddToQueue={onAddToQueue} />

      {r.live.length > 0 && (
        <section className="flex flex-col">
          <ShelfHeader
            title={getString('search_section_live')}
            onSeeAll={() => setFilterType('live')}
            seeAllLabel={getString('search_see_all_live')}
          />
          <VideoGrid videos={r.live} rows={1} onPlay={onPlayVideo} onAddToQueue={onAddToQueue} />
        </section>
      )}

      {r.albums.length > 0 && (
        <MusicShelf<AlbumItem>
          title={getString('search_cat_albums')}
          onSeeAll={() => setFilterType('albums')}
          items={r.albums}
          renderItem={(a) => (
            <MusicItemCard variant="album" item={a} onPlay={() => actions.openAlbum(a)} onOpen={() => actions.openAlbum(a)} />
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
              <PlaylistCard playlist={toPlaylistSummary(p)} onClick={() => actions.openPlaylist(p)} />
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
              <ArtistCard artist={it.item} onOpen={() => actions.openArtist(it.item)} />
            ) : (
              <SearchChannelCard channel={it.item} />
            )
          }
        />
      )}

      {r.podcasts.length > 0 && (
        <MusicShelf
          title={getString('search_section_podcasts')}
          onSeeAll={() => setFilterType('podcasts')}
          items={r.podcasts}
          renderItem={(p) => (
            <MusicItemCard variant="podcast" item={p} onOpen={() => actions.openPodcast(p)} onPlay={() => actions.openPodcast(p)} />
          )}
        />
      )}

      {r.episodes.length > 0 && (
        <MusicShelf
          title={getString('search_section_episodes')}
          onSeeAll={() => setFilterType('episodes')}
          items={r.episodes}
          renderItem={(e) => <MusicItemCard variant="episode" item={e} onPlay={() => actions.playEpisode(e, r.episodes)} />}
        />
      )}
    </div>
  );
}
