import { useNavigate } from 'react-router-dom';
import { VideoCard } from '../video/VideoCard';
import { ShelfScroller } from '../ui/ShelfScroller';
import { SubscribeButton } from '../ui/SubscribeButton';
import { upgradeAvatarUrl } from '../../lib/thumbnails';
import { useProxiedImageUrl } from '../../lib/useProxiedImageUrl';
import { getString } from '../../lib/i18n/index';
import type { SearchCreator } from '../../lib/searchResults';
import type { VideoSummary } from '../../types/video';

interface SearchCreatorCardProps {
  creator: SearchCreator;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}

/** A creator among the results, with their latest uploads under their name. */
export function SearchCreatorCard({ creator, onPlay, onAddToQueue }: SearchCreatorCardProps) {
  const { channel, latest } = creator;
  const navigate = useNavigate();
  const avatar = useProxiedImageUrl(upgradeAvatarUrl(channel.avatarUrl));
  const open = () => navigate(`/channel/${channel.channelId}`);
  const subtitle = [channel.handle, channel.subscriberCountText].filter(Boolean).join(' • ');

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={open}
          className="flex min-w-0 flex-1 items-center gap-4 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-surface-container-high">
            {avatar ? <img src={avatar} alt={channel.name} className="h-full w-full object-cover" loading="lazy" /> : null}
          </span>
          <span className="min-w-0">
            <span className="line-clamp-1 text-base font-medium text-chrome-neutral-100">{channel.name}</span>
            <span className="line-clamp-1 text-sm text-chrome-neutral-400">
              {subtitle || getString('search_role_channel')}
            </span>
          </span>
        </button>
        <SubscribeButton channelId={channel.channelId} channelName={channel.name} avatarUrl={channel.avatarUrl ?? undefined} />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-chrome-neutral-400">{latest.title}</h3>
        <ShelfScroller className="flex gap-4">
          {latest.videos.map((video) => (
            <div key={video.id} className="w-64 shrink-0">
              <VideoCard video={video} onPlay={onPlay} onAddToQueue={onAddToQueue} />
            </div>
          ))}
        </ShelfScroller>
      </div>
    </section>
  );
}
