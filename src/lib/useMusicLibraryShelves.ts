import { useEffect, useMemo } from 'react';

import { getString } from './i18n/index';
import { storedAlbumToItem, useAlbumLibraryStore } from '../store/useAlbumLibraryStore';
import { useSubscriptionStore } from '../store/useSubscriptionStore';
import type { PersonalSection } from './useMusicPersonalization';

/** Your own lists and the artists you follow, at the top of the music home. */
export function useMusicLibraryShelves(): PersonalSection[] {
  const albums = useAlbumLibraryStore((state) => state.albums);
  const loaded = useAlbumLibraryStore((state) => state.loaded);
  const load = useAlbumLibraryStore((state) => state.load);
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  return useMemo(() => {
    const sections: PersonalSection[] = [];
    const owned = albums.filter((album) => album.source === 'Owned');
    if (owned.length > 0) {
      sections.push({
        id: 'your-playlists',
        title: getString('music_home_your_playlists'),
        route: '/albums',
        items: owned.map((album) => ({ type: 'album' as const, ...storedAlbumToItem(album) })),
      });
    }
    const artists = subscriptions.filter((channel) => channel.isMusic);
    if (artists.length > 0) {
      sections.push({
        id: 'your-subscriptions',
        title: getString('music_home_your_subscriptions'),
        route: '/subscriptions',
        items: artists.map((channel) => ({
          type: 'artist' as const,
          id: channel.id,
          title: channel.name,
          thumbnail: channel.avatarUrl ?? null,
          channelId: channel.id,
        })),
      });
    }
    return sections;
  }, [albums, subscriptions]);
}
