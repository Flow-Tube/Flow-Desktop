import { useNavigate } from 'react-router-dom';
import { useMusicPlayerStore } from '../../../store/useMusicPlayerStore';
import { episodeAsSong } from '../../../lib/searchResults';
import { artistTopResultMix } from '../../../lib/artistTopResultMix';
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
    /** Plays the artist's own Shuffle or Radio queue, or opens the artist when there is none. */
    startArtistMix: async (artist: ArtistItem, kind: 'shuffle' | 'radio') => {
      const queue = await artistTopResultMix(artist.id, kind).catch((error: unknown) => {
        console.warn('Artist mix from search failed; opening the artist instead', error);
        return [];
      });
      if (queue.length > 0) void playQueue(queue, 0, artist.title);
      else navigate(`/music/artist/${artist.id}`);
    },
  };
}

export type ResultActions = ReturnType<typeof useResultActions>;
