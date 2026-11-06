import { getPlural, getString } from "../../lib/i18n/index";
import type { HomeMix } from "../../lib/api/homeFeed";
import { StackedPlaylistThumbnail } from "../video/PlaylistCard";

interface HomeMixCardProps {
  mix: HomeMix;
  onPlay: (mix: HomeMix) => void;
}

export function HomeMixCard({ mix, onPlay }: HomeMixCardProps) {
  const title = getString("home_mix_title", mix.seed.title);
  return (
    <button
      type="button"
      onClick={() => onPlay(mix)}
      className="group flex w-full flex-col gap-3 rounded-xl text-left transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <StackedPlaylistThumbnail
        thumbnailUrl={mix.seed.thumbnailUrl}
        title={title}
        videoCountText={getPlural("home_mix_length", mix.videos.length)}
      />
      <div className="min-w-0 px-1">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-chrome-neutral-100 transition-colors group-hover:text-primary">
          {title}
        </h3>
        <p className="mt-0.5 truncate text-[13px] text-chrome-neutral-400">{mix.seed.channelName}</p>
      </div>
    </button>
  );
}
