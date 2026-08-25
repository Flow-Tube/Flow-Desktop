import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Check, ChevronRight, Music2, Play, Plus } from 'lucide-react';

import { Button, type ButtonProps } from '../../components/ui/Button';
import { AlbumTrackRow } from '../../components/music/AlbumTrackRow';
import { ArtistSkeleton } from '../../components/music/ArtistSkeleton';
import { MusicItemCard } from '../../components/music/MusicItemCard';
import { MusicShelf } from '../../components/music/MusicShelf';
import { useArtistPage, type ArtistMoreEndpoint } from '../../lib/useArtistPage';
import { usePublishTitle } from '../../lib/usePublishTitle';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { getString } from '../../lib/i18n/index';
import { upgradeAvatarUrl } from '../../lib/thumbnails';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import type { SongItem } from '../../types/music';

const videoIdOf = (track: SongItem) => track.videoId ?? track.id;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function SectionTitle({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between px-1">
      <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{title}</h2>
      {onSeeAll ? (
        <button
          type="button"
          onClick={onSeeAll}
          className="group flex items-center gap-0.5 text-sm font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
        >
          {getString('music_show_all')}
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      ) : null}
    </div>
  );
}

function ArtistActionButton({
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <Button
      size="lg"
      className={cx(
        'text-sm font-semibold',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export function ShuffleGlyph({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
    >
      <path d="M20 18h-3.5c-2 0-3.5-1.5-4.5-3l-4-6C7 7.5 5.5 6 3.5 6H2" />
      <path d="M20 6h-3.5c-2 0-3.5 1.5-4.5 3l-4 6C7 16.5 5.5 18 3.5 18H2" />
      <path d="M17 3l3 3-3 3" />
      <path d="M17 15l3 3-3 3" />
    </svg>
  );
}

export function RadioGlyph({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
    >
      <circle cx="12" cy="12" r="2" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M4.9 4.9a10 10 0 0 0 0 14.2" />
      <path d="M19.1 4.9a10 10 0 0 1 0 14.2" />
    </svg>
  );
}

function ArtistHeroScaffold({
  title,
  thumbnail,
  subtitle,
  hasSongs,
  following,
  onPlay,
  onShuffle,
  onRadio,
  onToggleFollow,
}: {
  title: string;
  thumbnail: string | null;
  subtitle: string;
  hasSongs: boolean;
  following: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onRadio: () => void;
  onToggleFollow: () => void;
}) {
  const imageUrl = useProxiedImageUrl(upgradeAvatarUrl(thumbnail, 1200));

  return (
    <header className="relative flex h-[50vh] min-h-[400px] w-full items-end overflow-hidden bg-[var(--color-surface)] px-8 pb-8">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          aria-hidden="true"
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover object-center opacity-40 blur-[100px]"
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-surface-container" />
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[var(--color-surface)]/80 to-[var(--color-background)]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-col items-start gap-6 md:flex-row md:items-end">
        <div className="h-40 w-40 shrink-0 overflow-hidden rounded-full bg-surface-container-high shadow-2xl ring-4 ring-[var(--color-surface)] md:h-56 md:w-56">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              aria-hidden="true"
              decoding="async"
              className="h-full w-full object-cover object-center"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-chrome-neutral-500">
              <Music2 className="h-14 w-14" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-chrome-neutral-300">
            <span>{getString('music_role_artist')}</span>
          </div>
          <h1 className="mb-4 mt-3 line-clamp-2 text-6xl font-extrabold leading-none tracking-tighter text-chrome-white lg:text-8xl">
            {title}
          </h1>
          {subtitle ? <p className="text-lg text-chrome-neutral-400">{subtitle}</p> : null}

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <ArtistActionButton
              disabled={!hasSongs}
              onClick={onPlay}
              className="bg-chrome-white px-8 py-3 text-base font-bold text-chrome-black hover:bg-chrome-neutral-200"
            >
              <Play className="h-5 w-5" fill="currentColor" strokeWidth={2.4} />
              {getString('music_play')}
            </ArtistActionButton>
            <ArtistActionButton
              onClick={onToggleFollow}
              className="bg-chrome-white/10 text-chrome-white backdrop-blur-md hover:bg-chrome-white/20"
              aria-pressed={following}
            >
              {following ? (
                <Check className="h-5 w-5" strokeWidth={2.4} />
              ) : (
                <Plus className="h-5 w-5" strokeWidth={2.4} />
              )}
              {following ? getString('music_artist_following') : getString('music_artist_follow')}
            </ArtistActionButton>
            <ArtistActionButton
              disabled={!hasSongs}
              onClick={onShuffle}
              className="h-12 w-12 bg-chrome-white/10 px-0 text-chrome-neutral-50 backdrop-blur-md hover:bg-chrome-white/20 [&>svg]:shrink-0"
              aria-label={getString('music_shuffle')}
              title={getString('music_shuffle')}
            >
              <ShuffleGlyph />
            </ArtistActionButton>
            <ArtistActionButton
              disabled={!hasSongs}
              onClick={onRadio}
              className="h-12 w-12 bg-chrome-white/10 px-0 text-chrome-neutral-50 backdrop-blur-md hover:bg-chrome-white/20 [&>svg]:shrink-0"
              aria-label="Radio"
              title="Radio"
            >
              <RadioGlyph />
            </ArtistActionButton>
          </div>
        </div>
      </div>
    </header>
  );
}

export default function ArtistPage() {
  const { artistId } = useParams<{ artistId: string }>();
  const navigate = useNavigate();
  const playQueue = useMusicPlayerStore((state) => state.playQueue);
  const addToQueue = useMusicPlayerStore((state) => state.addToQueue);
  const currentTrack = useMusicPlayerStore((state) => state.currentTrack);
  const isPlaying = useMusicPlayerStore((state) => state.isPlaying);
  const { data, loading, error, reload } = useArtistPage(artistId);
  usePublishTitle(data?.header?.title);

  const [following, setFollowing] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);

  if (loading && !data) return <ArtistSkeleton />;

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <AlertTriangle className="h-8 w-8 text-chrome-neutral-500" />
        <p className="text-sm text-chrome-neutral-400">{getString('music_artist_unavailable')}</p>
        <div className="flex items-center gap-3">
          <Button variant="tonal" onClick={() => navigate(-1)}>
            {getString('music_artist_back')}
          </Button>
          <Button variant="primary" onClick={() => void reload()}>
            {getString('music_retry')}
          </Button>
        </div>
      </div>
    );
  }

  const {
    header,
    topSongs,
    topSongsMore,
    albums,
    albumsMore,
    singles,
    singlesMore,
    videos,
    related,
    about,
  } = data;
  const subtitle = [header.subscriberCountText, header.monthlyListenerCount]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' / ');
  const currentTrackId = currentTrack ? videoIdOf(currentTrack) : null;
  const aboutExpandable = Boolean(about && about.length > 240);

  const startPlayback = (shuffle: boolean) => {
    if (!topSongs.length) return;
    const queue: SongItem[] = shuffle ? [...topSongs].sort(() => Math.random() - 0.5) : topSongs;
    void playQueue(queue, 0);
  };

  const playFrom = (list: SongItem[], track: SongItem) => {
    const start = Math.max(0, list.findIndex((item) => videoIdOf(item) === videoIdOf(track)));
    void playQueue(list, start);
  };

  const openAlbum = (browseId: string) => navigate(`/music/album/${browseId}`);
  const openArtist = (id: string) => navigate(`/music/artist/${id}`);

  const seeAll = (kind: 'songs' | 'albums', more: ArtistMoreEndpoint | null, sectionTitle: string) => {
    if (!more?.browseId) return;
    const query = new URLSearchParams({ browseId: more.browseId, kind, title: sectionTitle });
    if (more.params) query.set('params', more.params);
    navigate(`/music/artist/${header.id}/items?${query.toString()}`);
  };

  return (
    <div className="min-h-full bg-[var(--color-background)] pb-32">
      <ArtistHeroScaffold
        title={header.title}
        thumbnail={header.thumbnail}
        subtitle={subtitle}
        hasSongs={topSongs.length > 0}
        following={following}
        onPlay={() => startPlayback(false)}
        onShuffle={() => startPlayback(true)}
        onRadio={() => startPlayback(true)}
        onToggleFollow={() => setFollowing((value) => !value)}
      />

      <main className="mx-auto flex max-w-[1600px] flex-col gap-12 px-8 pt-8">
        {topSongs.length > 0 ? (
          <section data-artist-section="popular">
            <SectionTitle
              title={getString('music_artist_popular')}
              onSeeAll={
                topSongsMore?.browseId
                  ? () => seeAll('songs', topSongsMore, getString('music_artist_popular'))
                  : undefined
              }
            />
            <div className="mt-4 grid gap-x-12 gap-y-2 lg:grid-cols-2">
              {topSongs.slice(0, 10).map((song, index) => {
                const songId = videoIdOf(song);
                const isCurrentSong = currentTrackId === songId;

                return (
                  <AlbumTrackRow
                    key={`${songId}-${index}`}
                    track={song}
                    index={index}
                    isCurrent={isCurrentSong}
                    isPlaying={isPlaying}
                    showArtwork
                    showStreamsColumn={false}
                    compactActions
                    onPlay={() => playFrom(topSongs, song)}
                    onAddToQueue={addToQueue}
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        <section data-artist-section="discography" className="flex flex-col gap-12">
          <MusicShelf
            title={getString('music_artist_albums')}
            items={albums}
            onSeeAll={
              albumsMore?.browseId
                ? () => seeAll('albums', albumsMore, getString('music_artist_albums'))
                : undefined
            }
            renderItem={(album) => (
              <MusicItemCard
                variant="album"
                item={album}
                onPlay={() => openAlbum(album.browseId)}
                onOpen={() => openAlbum(album.browseId)}
              />
            )}
          />

          <MusicShelf
            title={getString('music_artist_singles')}
            items={singles}
            onSeeAll={
              singlesMore?.browseId
                ? () => seeAll('albums', singlesMore, getString('music_artist_singles'))
                : undefined
            }
            renderItem={(single) => (
              <MusicItemCard
                variant="album"
                item={single}
                onPlay={() => openAlbum(single.browseId)}
                onOpen={() => openAlbum(single.browseId)}
              />
            )}
          />

          <MusicShelf
            title={getString('music_artist_videos')}
            items={videos}
            renderItem={(video) => (
              <MusicItemCard variant="video" item={video} onPlay={() => playFrom(videos, video)} />
            )}
          />
        </section>

        <MusicShelf
          title={getString('music_artist_related')}
          items={related}
          skeletonShape="circle"
          renderItem={(artist) => (
            <MusicItemCard variant="artist" item={artist} onOpen={() => openArtist(artist.id)} />
          )}
        />

        {about ? (
          <section data-artist-section="about">
            <SectionTitle title={getString('music_artist_about')} />
            <button
              type="button"
              onClick={() => {
                if (aboutExpandable) setAboutExpanded((value) => !value);
              }}
              aria-expanded={aboutExpanded}
              className={cx(
                'group relative mt-12 mb-24 w-full overflow-hidden rounded-2xl bg-surface-container-low p-6 text-left outline-none transition-colors duration-200 ease-out md:p-8 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
                aboutExpandable
                  ? 'cursor-pointer pb-16 hover:bg-surface-container md:pb-16'
                  : 'cursor-default',
              )}
            >
              <p
                className={cx(
                  'whitespace-pre-line text-base leading-relaxed text-chrome-neutral-300 transition-[max-height] duration-300 ease-out',
                  aboutExpanded || !aboutExpandable ? 'max-h-[1200px]' : 'line-clamp-4 max-h-28',
                )}
              >
                {about}
              </p>
              {!aboutExpanded && aboutExpandable ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--color-surface-container-low)] via-[var(--color-surface-container-low)]/95 to-transparent transition-colors duration-200 ease-out group-hover:from-[var(--color-surface-container)] group-hover:via-[var(--color-surface-container)]/95"
                />
              ) : null}
              {aboutExpandable ? (
                <span className="absolute bottom-5 left-6 z-10 text-sm font-bold text-chrome-neutral-100 md:left-8">
                  {aboutExpanded
                    ? getString('music_artist_read_less')
                    : getString('music_artist_read_more')}
                </span>
              ) : null}
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
