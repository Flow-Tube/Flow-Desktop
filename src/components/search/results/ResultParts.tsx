import type { Ref } from 'react';
import { Loader2 } from 'lucide-react';
import { ChannelCard } from '../../channel/ChannelCard';
import { VideoGrid } from '../../video/VideoGrid';
import { getString } from '../../../lib/i18n/index';
import { Button } from '../../ui/Button';
import type { PlaylistItem } from '../../../types/music';
import type { PlaylistSummary, SearchChannel, SearchShelf, VideoSummary } from '../../../types/video';

// Column count and card floor come from the user's grid preference (useGridStyle).
export const RESULT_GRID = 'flow-grid gap-y-8';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function toPlaylistSummary(p: PlaylistItem): PlaylistSummary {
  return {
    type: 'playlist',
    id: p.id,
    title: p.title,
    thumbnailUrl: p.thumbnail,
    videoCountText: p.songCountText,
  };
}

export function SearchChannelCard({ channel, fill }: { channel: SearchChannel; fill?: boolean }) {
  return (
    <ChannelCard
      fill={fill}
      channelId={channel.channelId}
      name={channel.name}
      avatarUrl={channel.avatarUrl}
      subtitle={channel.subscriberCountText ?? channel.handle}
    />
  );
}

export function ShelfHeader({
  title,
  onSeeAll,
  seeAllLabel,
}: {
  title: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between px-1">
      <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{title}</h2>
      {onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="text-sm font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
        >
          {seeAllLabel ?? getString('music_show_all')}
        </button>
      )}
    </div>
  );
}

/** "Latest from …" and the other titled runs of videos a search answers with. */
export function VideoShelves({
  shelves,
  onPlay,
  onAddToQueue,
}: {
  shelves: SearchShelf[];
  onPlay: (v: VideoSummary) => void;
  onAddToQueue: (v: VideoSummary) => void;
}) {
  return (
    <>
      {shelves.map((shelf) => (
        <section key={shelf.title} className="flex flex-col">
          <ShelfHeader title={shelf.title} />
          <VideoGrid videos={shelf.videos.slice(0, 8)} onPlay={onPlay} onAddToQueue={onAddToQueue} />
        </section>
      ))}
    </>
  );
}

/** The point that loads the next page once it scrolls into view, a spinner while it loads, and Retry when it failed. */
export function LoadMore({ sentinelRef, loading, failed, onRetry }: { sentinelRef: Ref<HTMLDivElement>; loading: boolean; failed: boolean; onRetry: () => void }) {
  return (
    <>
      <div ref={sentinelRef} className="h-10" />
      {failed && !loading && (
        <div className="flex items-center justify-center gap-3 border-t border-outline-variant py-4 text-sm text-chrome-neutral-400">
          {getString('search_more_failed')}
          <Button variant="tonal" size="sm" onClick={onRetry}>
            {getString('player_error_retry')}
          </Button>
        </div>
      )}
      {loading && (
        <div className="flex items-center justify-center py-6 text-chrome-neutral-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
    </>
  );
}
