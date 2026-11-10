import type { MusicRecap, RankedItem, RecapIndex, VideoRecap } from "../../lib/api/recap";
import { getPlural, getString } from "../../lib/i18n/index";
import { spentTimeLabel } from "../../lib/recap/recapFormat";
import { sponsorBlockCategoryLabel } from "../../lib/sponsorBlockCategories";
import { SplitBar, type Share } from "./charts/SplitBar";
import { RankRows } from "./RankRows";
import { Figure, RecapCard } from "./RecapCard";

const RANKED_ROWS = 5;
const SHORT_LIST = 3;
const TOP_NAMES = 8;
const LIST_SPAN = "col-span-12 md:col-span-6 xl:col-span-4";

const viewsLabel = (item: RankedItem) => getPlural("recap_views_count", item.count);
const playsLabel = (item: RankedItem) => getPlural("recap_plays_count", item.count);
const timesLabel = (item: RankedItem) => getPlural("recap_times_count", item.count);

interface RankCardProps {
  title: string;
  items: RankedItem[];
  value: (item: RankedItem) => string;
  portraits?: boolean;
  onOpen?: (item: RankedItem) => void;
}

export function RankCard({ title, items, value, portraits, onOpen }: RankCardProps) {
  return (
    <RecapCard span={LIST_SPAN} title={title}>
      <RankRows items={items.slice(0, RANKED_ROWS)} value={value} portraits={portraits} onOpen={onOpen} />
    </RecapCard>
  );
}

export function VideoRankCards({ video, onOpen }: { video: VideoRecap; onOpen: (item: RankedItem) => void }) {
  return (
    <>
      {video.topChannels.length > 0 && (
        <RankCard title={getString("recap_top_channels")} items={video.topChannels} value={viewsLabel} portraits onOpen={onOpen} />
      )}
      {video.topVideos.length > 0 && (
        <RankCard title={getString("recap_top_videos")} items={video.topVideos} value={timesLabel} onOpen={onOpen} />
      )}
      {video.topTopics.length > 0 && <TopicsCard video={video} />}
    </>
  );
}

export function MusicRankCards({ music, onOpen }: { music: MusicRecap; onOpen: (item: RankedItem) => void }) {
  return (
    <>
      {music.topArtists.length > 0 && (
        <RankCard title={getString("recap_top_artists")} items={music.topArtists} value={playsLabel} portraits onOpen={onOpen} />
      )}
      {music.topTracks.length > 0 && (
        <RankCard title={getString("recap_top_tracks")} items={music.topTracks} value={playsLabel} onOpen={onOpen} />
      )}
    </>
  );
}

function TopicsCard({ video }: { video: VideoRecap }) {
  return (
    <RecapCard
      span={LIST_SPAN}
      title={getString("recap_topics_title")}
      subtitle={video.newTopics.length > 0 ? getString("recap_topics_new", video.newTopics.join(", ")) : undefined}
    >
      <ul className="flex flex-wrap gap-2">
        {video.topTopics.map((topic) => (
          <li key={topic.id} className="rounded-full bg-surface-container-high px-3 py-1 text-sm text-on-surface">
            {topic.name}
          </li>
        ))}
      </ul>
    </RecapCard>
  );
}

/** How time split between long videos, Shorts, live and music. */
export function FormatsCard({ video, music }: { video: VideoRecap | null; music: MusicRecap | null }) {
  const shares: Share[] = [
    { label: getString("recap_format_long"), value: video?.formatMs.LONG ?? 0, fill: "fill-primary", swatch: "bg-primary" },
    { label: getString("recap_format_shorts"), value: video?.formatMs.SHORT ?? 0, fill: "fill-primary/60", swatch: "bg-primary/60" },
    { label: getString("recap_format_live"), value: video?.formatMs.LIVE ?? 0, fill: "fill-primary/30", swatch: "bg-primary/30" },
    { label: getString("recap_format_music"), value: music?.activity.totalMs ?? 0, fill: "fill-chrome-neutral-400", swatch: "bg-chrome-neutral-400" },
  ].filter((share) => share.value > 0);
  if (shares.length === 0) return null;
  return (
    <RecapCard span={LIST_SPAN} title={getString("recap_formats_title")}>
      <SplitBar
        shares={shares}
        format={spentTimeLabel}
        ariaLabel={shares.map((share) => `${share.label} ${spentTimeLabel(share.value)}`).join(", ")}
      />
    </RecapCard>
  );
}

function NamedGroup({ heading, items }: { heading: string; items: RankedItem[] }) {
  return (
    <div>
      <div className="text-sm font-medium text-on-surface">{heading}</div>
      <div className="mt-0.5 text-sm text-on-surface-variant">
        {items.slice(0, TOP_NAMES).map((item) => item.name).join(", ")}
      </div>
    </div>
  );
}

export function DiscoveriesCard({ video, music }: { video: VideoRecap | null; music: MusicRecap | null }) {
  const channels = video?.discoveredChannels ?? [];
  const artists = music?.discoveredArtists ?? [];
  if (channels.length === 0 && artists.length === 0) return null;
  return (
    <RecapCard span={LIST_SPAN} title={getString("recap_discoveries_title")}>
      {channels.length > 0 && <NamedGroup heading={getPlural("recap_new_channels", channels.length)} items={channels} />}
      {artists.length > 0 && <NamedGroup heading={getPlural("recap_new_artists", artists.length)} items={artists} />}
    </RecapCard>
  );
}

/** Skips, dislikes and blocks: shown plainly, never as a judgement. */
export function PassedOnCard({
  video,
  music,
  onOpen,
}: {
  video: VideoRecap | null;
  music: MusicRecap | null;
  onOpen: (item: RankedItem) => void;
}) {
  const dislikes = video?.dislikes.length ?? 0;
  const notInterested = (video?.actions.NOT_INTERESTED ?? 0) + (music?.dislikedArtists.length ?? 0);
  const blocked = (video?.actions.BLOCK_CHANNEL ?? 0) + (music?.blockedArtists.length ?? 0);
  const skippedVideos = video?.skippedVideos ?? [];
  const skippedTracks = music?.skippedTracks ?? [];
  if (dislikes + notInterested + blocked + skippedVideos.length + skippedTracks.length === 0) return null;
  return (
    <RecapCard span={LIST_SPAN} title={getString("recap_passed_title")} subtitle={getString("recap_passed_subtitle")}>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {video && <Figure value={String(dislikes)} label={getString("recap_dislikes")} />}
        <Figure value={String(notInterested)} label={getString("recap_not_interested")} />
        <Figure value={String(blocked)} label={getString("recap_blocked")} />
      </div>
      {skippedVideos.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-on-surface">{getString("recap_skipped_videos")}</h3>
          <RankRows items={skippedVideos.slice(0, SHORT_LIST)} value={timesLabel} onOpen={onOpen} />
        </div>
      )}
      {skippedTracks.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-on-surface">{getString("recap_skipped_tracks")}</h3>
          <RankRows items={skippedTracks.slice(0, SHORT_LIST)} value={timesLabel} onOpen={onOpen} />
        </div>
      )}
    </RecapCard>
  );
}

export function LibraryCard({ video }: { video: VideoRecap }) {
  const { actions } = video;
  return (
    <RecapCard span={LIST_SPAN} title={getString("recap_library_title")}>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Figure value={String(actions.LIKE ?? 0)} label={getString("recap_likes")} />
        <Figure value={String(actions.SAVE ?? 0)} label={getString("recap_saves")} />
        <Figure value={String(actions.DOWNLOAD ?? 0)} label={getString("recap_downloads")} />
        <Figure value={String(actions.SEARCH ?? 0)} label={getString("recap_searches")} />
      </div>
      {video.topQueries.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-on-surface">{getString("recap_top_searches")}</h3>
          <RankRows items={video.topQueries.slice(0, SHORT_LIST)} value={timesLabel} images={false} />
        </div>
      )}
    </RecapCard>
  );
}

export function SponsorCard({ video }: { video: VideoRecap }) {
  const categories = Object.entries(video.sponsorSkippedMs).sort((a, b) => b[1] - a[1]);
  return (
    <RecapCard span={LIST_SPAN} title={getString("recap_sponsor_title")}>
      <Figure emphasized value={spentTimeLabel(video.sponsorSavedMs)} label={getString("recap_sponsor_label")} />
      <ul className="flex flex-col gap-1.5">
        {categories.map(([category, ms]) => (
          <li key={category} className="flex justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-on-surface-variant">{sponsorBlockCategoryLabel(category)}</span>
            <span className="shrink-0 tabular-nums text-on-surface">{spentTimeLabel(ms)}</span>
          </li>
        ))}
      </ul>
    </RecapCard>
  );
}

export function HistoryCard({ channels, onOpen }: { channels: RecapIndex["historyChannels"]; onOpen: (item: RankedItem) => void }) {
  const items: RankedItem[] = channels.slice(0, RANKED_ROWS).map(([id, name, videos]) => ({
    id,
    name: name || id,
    count: videos,
    durationMs: 0,
    detail: "",
    imageUrl: "",
    kind: "CHANNEL",
  }));
  return (
    <RecapCard span={LIST_SPAN} title={getString("recap_history_title")} subtitle={getString("recap_history_subtitle")}>
      <RankRows items={items} value={(item) => getPlural("recap_videos_count", item.count)} portraits onOpen={onOpen} />
    </RecapCard>
  );
}
