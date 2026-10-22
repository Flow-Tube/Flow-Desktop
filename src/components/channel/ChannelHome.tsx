import React from "react";
import { ChevronRight } from "lucide-react";
import { VideoShelf } from "../shelf/VideoShelf";
import { ShortsShelf } from "../shelf/ShortsShelf";
import { PlaylistShelf } from "../shelf/PlaylistShelf";
import { PostShelf } from "../shelf/PostShelf";
import { ChannelShelf } from "../shelf/ChannelShelf";
import { getString } from "../../lib/i18n/index";
import { itemsOfLayout, sectionLayout } from "../../lib/channelPage";
import type {
  ChannelSection,
  ChannelSummaryItem,
  PlaylistSummary,
  PostSummary,
  ShortVideoSummary,
  VideoItemSummary,
  VideoSummary,
} from "../../types/video";

interface ChannelHomeProps {
  sections: ChannelSection[];
  watched: VideoSummary[];
  /** Whether a section's "See all" leads anywhere. */
  canSeeAll: (section: ChannelSection) => boolean;
  onSeeAll: (section: ChannelSection) => void;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}

function SectionView({
  section,
  action,
  onPlay,
  onAddToQueue,
}: {
  section: ChannelSection;
  action?: React.ReactNode;
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}) {
  const title = section.isTrailer ? getString("channel_trailer") : section.title;
  switch (sectionLayout(section)) {
    case "shorts":
      return (
        <ShortsShelf
          title={title}
          action={action}
          shorts={itemsOfLayout<ShortVideoSummary>(section.items, "shorts")}
          onPlay={onPlay}
        />
      );
    case "playlists":
      return (
        <PlaylistShelf
          title={title}
          action={action}
          playlists={itemsOfLayout<PlaylistSummary>(section.items, "playlists")}
        />
      );
    case "posts":
      return <PostShelf title={title} action={action} posts={itemsOfLayout<PostSummary>(section.items, "posts")} />;
    case "channels":
      return (
        <ChannelShelf
          title={title}
          action={action}
          channels={itemsOfLayout<ChannelSummaryItem>(section.items, "channels")}
        />
      );
    default:
      return (
        <VideoShelf
          title={title}
          action={action}
          videos={itemsOfLayout<VideoItemSummary>(section.items, "videos")}
          onPlay={onPlay}
          onAddToQueue={onAddToQueue}
        />
      );
  }
}

/** Home's shelves in the order the channel arranged them, with what the viewer watched after the first. */
export const ChannelHome: React.FC<ChannelHomeProps> = ({
  sections,
  watched,
  canSeeAll,
  onSeeAll,
  onPlay,
  onAddToQueue,
}) => {
  if (sections.length === 0 && watched.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-chrome-neutral-800 p-6 py-20 text-center text-sm font-medium text-chrome-neutral-500">
        {getString("channel_home_empty")}
      </p>
    );
  }
  const watchedAfter = sections.findIndex((section) => !section.isTrailer);
  const watchedShelf =
    watched.length > 0 ? (
      <VideoShelf
        key="watched"
        title={getString("channel_watched_title")}
        videos={watched}
        onPlay={onPlay}
        onAddToQueue={onAddToQueue}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-6 divide-y divide-chrome-neutral-900">
      {watchedAfter < 0 && watchedShelf}
      {sections.map((section, index) => (
        <React.Fragment key={`${index}:${section.title}`}>
          <SectionView
            section={section}
            onPlay={onPlay}
            onAddToQueue={onAddToQueue}
            action={
              canSeeAll(section) ? (
                <button
                  type="button"
                  onClick={() => onSeeAll(section)}
                  className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-chrome-neutral-300 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
                >
                  {getString("explore_see_all")}
                  <ChevronRight size={16} />
                </button>
              ) : undefined
            }
          />
          {index === watchedAfter && watchedShelf}
        </React.Fragment>
      ))}
    </div>
  );
};
