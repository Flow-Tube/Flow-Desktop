import { getString } from '../../lib/i18n/index';
import { useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Play, Shuffle } from 'lucide-react';

import { MusicItemCard } from '../../components/music/MusicItemCard';
import { Button } from '../../components/ui/Button';
import { useMusicMix } from '../../lib/useMusicMix';
import { mixFromRoute } from '../../lib/musicMixes';
import { shuffled } from '../../lib/musicRecall';
import { useAlbumLibraryStore } from '../../store/useAlbumLibraryStore';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { useMusicHiddenFilter } from '../../store/useMusicActionsStore';
import { useUiStore } from '../../store/useUiStore';

export default function MusicMixPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const searchKey = search.toString();
  const routeMix = useMemo(() => mixFromRoute(new URLSearchParams(searchKey)), [searchKey]);
  const { mix, songs: allSongs, loading, error, reload } = useMusicMix(id, routeMix);
  const isHidden = useMusicHiddenFilter();
  const songs = useMemo(() => allSongs.filter((song) => !isHidden(song)), [allSongs, isHidden]);
  const playQueue = useMusicPlayerStore((store) => store.playQueue);
  const loadLibrary = useAlbumLibraryStore((store) => store.load);
  const saved = useAlbumLibraryStore((store) => !!id && store.isSaved(id));
  const saveMix = useAlbumLibraryStore((store) => store.saveMix);
  const showToast = useUiStore((store) => store.showToast);
  useEffect(() => { void loadLibrary(); }, [loadLibrary]);
  const title = mix ? `${mix.label} ${getString('music_mix')}` : getString('music_mix');
  const play = (index: number) => { void playQueue(songs, index, title); };
  const shuffle = () => { void playQueue(shuffled(songs), 0, title); };
  const save = async () => {
    if (!id || !songs.length) return;
    try {
      await saveMix(id, title, songs);
      showToast({ variant: 'success', message: getString('music_mix_saved') });
    } catch {
      showToast({ variant: 'error', message: getString('music_mix_save_failed') });
    }
  };

  return <main className="mx-auto max-w-[1100px] px-6 py-8 lg:px-8">
    <h1 dir="auto" className="mb-5 text-3xl font-bold tracking-tight text-chrome-neutral-100">{title}</h1>
    {error && <div className="mb-5 flex items-center gap-3 text-sm text-chrome-neutral-400">
      <span>{error}</span><Button variant="secondary" onClick={() => void reload()}>{getString('music_retry')}</Button>
    </div>}
    {loading && !songs.length ? <div className="flex flex-col gap-2">
      {Array.from({ length: 12 }).map((_, index) => <div key={index}
        className="h-16 animate-pulse rounded-lg bg-surface-container-low" />)}
    </div> : songs.length ? <>
      <div className="mb-7 flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => play(0)}><Play className="h-4 w-4" />{getString('music_play')}</Button>
        <Button variant="secondary" onClick={shuffle}><Shuffle className="h-4 w-4" />{getString('music_shuffle')}</Button>
        <Button variant="secondary" onClick={saved ? () => navigate(`/music/album/${id}`) : () => void save()}>
          {getString(saved ? 'music_open_saved_mix' : 'music_save_mix')}
        </Button>
      </div>
      <div className="grid gap-x-8 gap-y-1 lg:grid-cols-2">
        {songs.map((song, index) => <MusicItemCard key={song.videoId ?? song.id} variant="track-list"
          item={song} onPlay={() => play(index)} />)}
      </div>
    </> : !error && <p className="py-16 text-sm text-chrome-neutral-400">{getString('music_chip_empty')}</p>}
  </main>;
}
