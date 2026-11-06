import type { ReactNode } from "react";

import type { RankedItem, RecapSummary } from "../../../lib/api/recap";
import { getPlural, getString } from "../../../lib/i18n/index";
import { dayLabel, INSIGHT_LABELS, scopeOf, spentTimeLabel } from "../../../lib/recap/recapFormat";
import type { StoryPage } from "../../../lib/recap/storyPages";
import { useChannelAvatar } from "../../../lib/useChannelAvatar";
import { useProxiedImageUrl } from "../../../lib/useProxiedImageUrl";
import { CalendarChart } from "../charts/CalendarChart";
import { ClockChart } from "../charts/ClockChart";
import { SplitBar, type Share } from "../charts/SplitBar";
import { StoryPosterPage } from "./StoryPosterPage";

const STORY_LIST = 5;
const NEW_FACES = 8;
const SHORT_LIST = 3;

const Eyebrow = ({ children }: { children: ReactNode }) => <p className="text-base font-semibold text-primary">{children}</p>;
const Hero = ({ children }: { children: ReactNode }) => (
  <p className="text-6xl font-black tabular-nums tracking-tight text-on-surface md:text-7xl">{children}</p>
);
const Headline = ({ children }: { children: ReactNode }) => (
  <h2 className="line-clamp-3 text-4xl font-bold tracking-tight text-on-surface">{children}</h2>
);
const Body = ({ children }: { children: ReactNode }) => <p className="text-base text-on-surface-variant">{children}</p>;

function Pill({ value, label, strong = false }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className={`rounded-2xl px-5 py-3 ${strong ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface"}`}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-sm">{label}</div>
    </div>
  );
}

function Portrait({ item, size }: { item: RankedItem; size: string }) {
  const looked = useChannelAvatar(item.kind === "CHANNEL" && !item.imageUrl ? item.id : null);
  const src = useProxiedImageUrl(item.imageUrl || looked);
  if (!src) {
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-surface-container-high font-bold text-on-surface-variant ${size}`}>
        {item.name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt="" className={`shrink-0 rounded-full object-cover ${size}`} />;
}

function FaceRow({ items }: { items: RankedItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-3">
      {items.map((item) => (
        <li key={item.id} className="flex w-20 flex-col items-center gap-1">
          <Portrait item={item} size="h-14 w-14" />
          <span className="w-full truncate text-center text-xs text-on-surface-variant">{item.name}</span>
        </li>
      ))}
    </ul>
  );
}

function ArtworkList({ items, value }: { items: RankedItem[]; value: (item: RankedItem) => string }) {
  return (
    <ol className="flex w-full flex-col gap-2">
      {items.map((item, index) => (
        <li key={item.id} className="flex items-center gap-3 rounded-2xl bg-surface-container-high p-2.5 text-left">
          <span className="w-6 shrink-0 text-center text-lg font-bold tabular-nums text-primary">{index + 1}</span>
          <ArtworkImage url={item.imageUrl} />
          <span className="min-w-0 flex-1 truncate text-base font-medium text-on-surface">{item.name || getString("recap_unnamed_item")}</span>
          <span className="shrink-0 text-sm tabular-nums text-on-surface-variant">{value(item)}</span>
        </li>
      ))}
    </ol>
  );
}

function ArtworkImage({ url }: { url: string }) {
  const src = useProxiedImageUrl(url);
  return src ? <img src={src} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <span className="h-12 w-12 shrink-0 rounded-xl bg-surface-container" />;
}

function RepeatArtwork({ video }: { video: RankedItem }) {
  const src = useProxiedImageUrl(video.imageUrl);
  return (
    <div className="relative w-full">
      {src && <img src={src} alt="" className="aspect-video w-full rounded-3xl object-cover" />}
      <span className="absolute -right-2 -top-2 flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-black tabular-nums text-on-primary">
        ×{video.count}
      </span>
    </div>
  );
}

function formatShares(summary: RecapSummary): Share[] {
  const { formatMs } = summary.video;
  return [
    { label: getString("recap_format_long"), value: formatMs.LONG ?? 0, fill: "fill-primary", swatch: "bg-primary" },
    { label: getString("recap_format_shorts"), value: formatMs.SHORT ?? 0, fill: "fill-primary/60", swatch: "bg-primary/60" },
    { label: getString("recap_format_live"), value: formatMs.LIVE ?? 0, fill: "fill-primary/30", swatch: "bg-primary/30" },
    { label: getString("recap_format_music"), value: summary.music.activity.totalMs, fill: "fill-chrome-neutral-400", swatch: "bg-chrome-neutral-400" },
  ].filter((share) => share.value > 0);
}

interface StoryPageContentProps {
  page: StoryPage;
  summary: RecapSummary;
  period: string;
  periodLabel: string;
}

/** The words, figures and portraits of one story page, in a readable centered column. */
export function StoryPageContent({ page, summary, period, periodLabel }: StoryPageContentProps) {
  const { video, music, combined } = summary;
  switch (page.kind) {
    case "intro":
      return (
        <>
          <Eyebrow>{getString("recap_story_intro", periodLabel)}</Eyebrow>
          <Hero>{spentTimeLabel(combined.totalMs)}</Hero>
          <Body>{getPlural("recap_story_intro_body", combined.activeDays)}</Body>
          <div className="flex flex-wrap justify-center gap-2">
            {video.views > 0 && <Pill value={String(video.views)} label={getString("recap_views")} />}
            {music.plays > 0 && <Pill value={String(music.plays)} label={getString("recap_plays")} />}
            <Pill value={String(combined.longestStreak)} label={getString("recap_streak")} />
          </div>
        </>
      );
    case "topChannel":
      return (
        <>
          <Portrait item={page.channel} size="h-44 w-44 text-6xl" />
          <Eyebrow>{getString("recap_story_top_channel")}</Eyebrow>
          <Headline>{page.channel.name}</Headline>
          <Body>{getString("recap_story_top_channel_body", getPlural("recap_views_count", page.channel.count), spentTimeLabel(page.channel.durationMs))}</Body>
          <FaceRow items={page.runnersUp} />
        </>
      );
    case "onRepeat":
      return (
        <>
          <RepeatArtwork video={page.video} />
          <Eyebrow>{getString("recap_story_repeat")}</Eyebrow>
          <Headline>{page.video.name || getString("recap_unnamed_item")}</Headline>
          {page.video.detail && <Body>{page.video.detail}</Body>}
        </>
      );
    case "topics":
      return (
        <>
          <Eyebrow>{getString("recap_story_topics")}</Eyebrow>
          <ul className="flex flex-wrap items-center justify-center gap-2">
            {video.topTopics.slice(0, STORY_LIST + 2).map((topic, index) => (
              <li
                key={topic.id}
                className={`rounded-full px-5 py-2 ${index === 0 ? "bg-primary text-3xl font-semibold text-on-primary" : "bg-surface-container-high text-lg text-on-surface"}`}
              >
                {topic.name}
              </li>
            ))}
          </ul>
          {video.newTopics.length > 0 && <Body>{getString("recap_topics_new", video.newTopics.join(", "))}</Body>}
        </>
      );
    case "clock": {
      const insight = summary.insights[0];
      return (
        <>
          <Eyebrow>{getString("recap_story_clock")}</Eyebrow>
          {insight && (
            <>
              <Headline>{getString(INSIGHT_LABELS[insight][0])}</Headline>
              <Body>{getString(INSIGHT_LABELS[insight][1])}</Body>
            </>
          )}
          <ClockChart hourCounts={combined.hourCounts} ariaLabel={getString("recap_clock_subtitle")} />
        </>
      );
    }
    case "streak":
      return (
        <>
          <Eyebrow>{getString("recap_story_streak")}</Eyebrow>
          <Hero>{getPlural("recap_days", combined.longestStreak)}</Hero>
          {combined.busiestDay && (
            <Body>{getString("recap_story_streak_body", dayLabel(combined.busiestDay[0]), spentTimeLabel(combined.busiestDay[1]))}</Body>
          )}
          {scopeOf(period) === "month" && (
            <CalendarChart month={period} dayMs={combined.dayMs} ariaLabel={getString("recap_calendar_title")} />
          )}
        </>
      );
    case "topArtist":
      return (
        <>
          <Portrait item={page.artist} size="h-44 w-44 text-6xl" />
          <Eyebrow>{getString("recap_story_artist")}</Eyebrow>
          <Headline>{page.artist.name}</Headline>
          <Body>{getString("recap_story_artist_body", getPlural("recap_plays_count", page.artist.count), page.sharePercent)}</Body>
        </>
      );
    case "songs":
      return (
        <>
          <Eyebrow>{getString("recap_story_songs")}</Eyebrow>
          <ArtworkList items={music.topTracks.slice(0, STORY_LIST)} value={(item) => getPlural("recap_plays_count", item.count)} />
        </>
      );
    case "newToYou": {
      const channels = video.discoveredChannels;
      const artists = music.discoveredArtists;
      return (
        <>
          <Eyebrow>{getString("recap_story_new")}</Eyebrow>
          {channels.length > 0 && <Headline>{getPlural("recap_new_channels", channels.length)}</Headline>}
          {artists.length > 0 && <Headline>{getPlural("recap_new_artists", artists.length)}</Headline>}
          <FaceRow items={[...channels, ...artists].slice(0, NEW_FACES)} />
        </>
      );
    }
    case "passedOn": {
      const skipped = video.skippedVideos.length > 0 ? video.skippedVideos : music.skippedTracks;
      return (
        <>
          <Eyebrow>{getString("recap_story_passed")}</Eyebrow>
          <div className="flex justify-center gap-2">
            <Pill value={String(video.dislikes.length)} label={getString("recap_dislikes")} />
            <Pill value={String(video.actions.NOT_INTERESTED ?? 0)} label={getString("recap_not_interested")} />
          </div>
          {skipped.length > 0 && (
            <ArtworkList items={skipped.slice(0, SHORT_LIST)} value={(item) => getPlural("recap_times_count", item.count)} />
          )}
        </>
      );
    }
    case "formats": {
      const shares = formatShares(summary);
      return (
        <>
          <Eyebrow>{getString("recap_story_formats")}</Eyebrow>
          <div className="w-full">
            <SplitBar
              shares={shares}
              format={spentTimeLabel}
              ariaLabel={shares.map((share) => `${share.label} ${spentTimeLabel(share.value)}`).join(", ")}
            />
          </div>
        </>
      );
    }
    case "sponsor":
      return (
        <>
          <Eyebrow>{getString("recap_story_sponsor")}</Eyebrow>
          <Hero>{spentTimeLabel(video.sponsorSavedMs)}</Hero>
          <Body>{getString("recap_sponsor_label")}</Body>
        </>
      );
    case "summary":
      return <StoryPosterPage summary={summary} period={period} periodLabel={periodLabel} />;
  }
}
