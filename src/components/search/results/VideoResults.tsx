import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { VideoCard } from '../../video/VideoCard';
import { VideoGrid } from '../../video/VideoGrid';
import { ShortsShelf } from '../../shelf/ShortsShelf';
import { PostShelf } from '../../shelf/PostShelf';
import { getString } from '../../../lib/i18n/index';
import { placeAmongVideos, type PlacedPostShelf, type PlacedShelf, type PlacedShortsShelf } from '../../../lib/searchResults';
import type { VideoSummary } from '../../../types/video';
import { ShelfHeader } from './ResultParts';

export type SearchLayout = 'list' | 'grid';

type Block =
  | ({ kind: 'shelf' } & PlacedShelf)
  | ({ kind: 'shorts' } & PlacedShortsShelf)
  | ({ kind: 'posts' } & PlacedPostShelf);

interface VideoResultsProps {
  videos: VideoSummary[];
  /** Every video id as it arrived, before filtering, so blocks keep their places. */
  order: string[];
  shelves?: PlacedShelf[];
  shortsShelves?: PlacedShortsShelf[];
  postShelves?: PlacedPostShelf[];
  layout: SearchLayout;
  query: string;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}

function VideoRun({ videos, layout, query, onPlay, onAddToQueue }: Pick<VideoResultsProps, 'videos' | 'layout' | 'query' | 'onPlay' | 'onAddToQueue'>) {
  if (layout === 'grid') return <VideoGrid videos={videos} onPlay={onPlay} onAddToQueue={onAddToQueue} />;
  return (
    <div className="flex flex-col gap-1">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} variant="search" highResThumbnail searchQuery={query} onPlay={onPlay} onAddToQueue={onAddToQueue} />
      ))}
    </div>
  );
}

/** "Latest from …" and the like, folded to YouTube's count until you ask for the rest. */
function VideoShelf({ shelf, ...run }: { shelf: PlacedShelf } & Pick<VideoResultsProps, 'layout' | 'query' | 'onPlay' | 'onAddToQueue'>) {
  const [expanded, setExpanded] = useState(false);
  const folds = shelf.collapsedCount != null && shelf.collapsedCount < shelf.videos.length;
  const videos = folds && !expanded ? shelf.videos.slice(0, shelf.collapsedCount ?? undefined) : shelf.videos;
  return (
    <section className="flex flex-col border-y border-outline-variant py-4">
      <ShelfHeader title={shelf.title} />
      <VideoRun videos={videos} {...run} />
      {folds && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="mt-2 inline-flex items-center gap-1 self-start rounded-full px-3 py-1.5 text-sm font-medium text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {getString(expanded ? 'search_shelf_show_less' : 'search_shelf_show_more')}
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

/** Video results with YouTube's shelves and Shorts strips where it put them. */
export function VideoResults({ videos, order, shelves = [], shortsShelves = [], postShelves = [], layout, query, onPlay, onAddToQueue }: VideoResultsProps) {
  const blocks: Block[] = [
    ...shortsShelves.map((shelf): Block => ({ kind: 'shorts', ...shelf })),
    ...shelves.map((shelf): Block => ({ kind: 'shelf', ...shelf })),
    ...postShelves.map((shelf): Block => ({ kind: 'posts', ...shelf })),
  ];
  const run = { layout, query, onPlay, onAddToQueue };
  return (
    <div className="flex flex-col gap-6">
      {placeAmongVideos(order, videos, blocks).map((row, index) => {
        if (row.kind === 'videos') return <VideoRun key={`videos:${row.videos[0]?.id ?? index}`} videos={row.videos} {...run} />;
        const block = row.block;
        if (block.kind === 'posts') {
          return (
            <PostShelf
              key={`posts:${block.posts[0]?.id ?? index}`}
              title={block.title ?? getString('search_section_posts')}
              posts={block.posts}
            />
          );
        }
        return block.kind === 'shorts' ? (
          <ShortsShelf
            key={`shorts:${block.shorts[0]?.id ?? index}`}
            title={block.title ?? getString('search_section_shorts')}
            shorts={block.shorts}
            onPlay={onPlay}
          />
        ) : (
          <VideoShelf key={`shelf:${block.title}:${index}`} shelf={block} {...run} />
        );
      })}
    </div>
  );
}
