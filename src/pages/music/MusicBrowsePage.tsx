import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { MusicItemCard } from '../../components/music/MusicItemCard';
import { Button } from '../../components/ui/Button';
import { useMusicChipFilter } from '../../lib/useMusicHome';
import { useGridStyle } from '../../lib/useGridColumns';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { useMusicArtistHidden, useMusicHiddenFilter } from '../../store/useMusicActionsStore';
import type { SongItem, YTItem } from '../../types/music';

export default function MusicBrowsePage() {
  const { t } = useTranslation('common');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const gridStyle = useGridStyle({ density: 'dense' });
  const playQueue = useMusicPlayerStore((store) => store.playQueue);
  const isHidden = useMusicHiddenFilter();
  const isArtistHidden = useMusicArtistHidden();
  const browseId = params.get('browseId');
  const browseParams = params.get('params');
  const title = params.get('title') || t('musicBrowse');
  const chip = useMemo(() => browseId ? {
    title, browseId, params: browseParams, orderBy: 0,
  } : null, [browseId, browseParams, title]);
  const { items, loading, loadingMore, error, reload, loadMore, hasMore } = useMusicChipFilter(chip);
  const visible = items.filter((item) => item.type !== 'podcast' && item.type !== 'episode')
    .filter((item) => item.type === 'song' ? !isHidden(item)
      : item.type === 'artist' ? !isArtistHidden(item) : true);
  const audioSongs = visible.filter((item): item is Extract<YTItem, { type: 'song' }> =>
    item.type === 'song' && (!item.musicVideoType || item.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV'));
  const play = (song: SongItem) => {
    const index = audioSongs.findIndex((item) => (item.videoId ?? item.id) === (song.videoId ?? song.id));
    void playQueue(audioSongs, Math.max(0, index), title);
  };
  const renderItem = (item: YTItem) => {
    switch (item.type) {
      case 'song':
        return item.musicVideoType && item.musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV'
          ? <MusicItemCard variant="video" item={item} fill
              onPlay={() => navigate(`/watch/${item.videoId ?? item.id}`)}
              onOpen={() => navigate(`/watch/${item.videoId ?? item.id}`)} />
          : <MusicItemCard variant="song" item={item} fill onPlay={() => play(item)} />;
      case 'album':
        return <MusicItemCard variant="album" item={item} fill
          onPlay={() => navigate(`/music/album/${item.browseId}`)}
          onOpen={() => navigate(`/music/album/${item.browseId}`)} />;
      case 'playlist':
        return <MusicItemCard variant="playlist" item={item} fill
          onPlay={() => navigate(`/music/playlist/${item.id}`)}
          onOpen={() => navigate(`/music/playlist/${item.id}`)} />;
      case 'artist':
        return <MusicItemCard variant="artist" item={item} fill
          onOpen={() => navigate(`/music/artist/${item.id}`)} />;
      default:
        return null;
    }
  };

  return <main className="px-6 py-8 lg:px-8">
    <h1 className="mb-6 text-3xl font-bold tracking-tight text-chrome-neutral-100">{title}</h1>
    {error && <div className="mb-6 flex items-center gap-3 text-sm text-chrome-neutral-400">
      <span>{error}</span><Button variant="secondary" onClick={reload}>{t('musicRetry')}</Button>
    </div>}
    {loading && !visible.length ? <div className="flow-grid gap-y-6" style={gridStyle}>
      {Array.from({ length: 12 }).map((_, index) => <div key={index}
        className="aspect-square animate-pulse rounded-xl bg-surface-container-low" />)}
    </div> : <div className="flow-grid gap-y-6" style={gridStyle}>
      {visible.map((item, index) => <div key={item.type === 'album' ? item.browseId
        : 'id' in item ? item.id : index}>{renderItem(item)}</div>)}
    </div>}
    {!loading && !error && !visible.length && <p className="py-20 text-center text-sm text-chrome-neutral-400">{t('musicChipEmpty')}</p>}
    {hasMore && <div className="flex justify-center py-8">
      <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{t('musicLoadMore')}</Button>
    </div>}
  </main>;
}
