import { useNavigate } from 'react-router-dom';
import { useMusicPlayerStore } from '../../../store/useMusicPlayerStore';
import { episodeAsSong } from '../../../lib/searchResults';
import type { AlbumItem, ArtistItem, EpisodeItem, PlaylistItem, PodcastItem, SongItem } from '../../../types/music';
import type { SearchChannel } from '../../../types/video';

/** What a click on each kind of result does. */
export function useResultActions() {
  const navigate = useNavigate();
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  return {
    // The song alone, so Up next fills with related songs instead of the other results for the same title.
    playSong: (song: SongItem) => void playQueue([song], 0),
    playEpisode: (episode: EpisodeItem, all: EpisodeItem[]) =>
      void playQueue(all.map(episodeAsSong), Math.max(0, all.indexOf(episode))),
    openAlbum: (a: AlbumItem) => navigate(`/music/album/${a.browseId}`),
    openArtist: (a: ArtistItem) => navigate(a.isProfile ? `/channel/${a.id}` : `/music/artist/${a.id}`),
    openPodcast: (p: PodcastItem) => navigate(`/music/playlist/${p.id}`),
    openPlaylist: (p: PlaylistItem) => navigate(`/music/playlist/${p.id}`),
    openVideoPlaylist: (id: string) => navigate(`/playlist/${id}`),
    openChannel: (c: SearchChannel) => navigate(`/channel/${c.channelId}`),
  };
}

export type ResultActions = ReturnType<typeof useResultActions>;
