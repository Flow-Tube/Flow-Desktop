import { ChartNoAxesColumn, Info } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Button } from "../components/ui/Button";
import { RecapControls } from "../components/recap/RecapControls";
import {
  DiscoveriesCard,
  FormatsCard,
  HistoryCard,
  LibraryCard,
  MusicRankCards,
  PassedOnCard,
  SponsorCard,
  VideoRankCards,
} from "../components/recap/RecapListCards";
import {
  CalendarCard,
  ClockCard,
  InsightsCard,
  OverviewCard,
  TimeCard,
  WeekdayCard,
} from "../components/recap/RecapOverviewCards";
import { getString } from "../lib/i18n/index";
import { dateLabel, isEmptySummary, scopeOf } from "../lib/recap/recapFormat";
import { useRecap, type RecapState } from "../lib/recap/useRecap";
import { useRecapLinks } from "../lib/recap/useRecapLinks";
import type { VideoSummary } from "../types/video";

function EmptyPanel({ title, body }: { title: string; body?: string }) {
  return (
    <div className="col-span-12 flex flex-col items-center gap-3 rounded-3xl border border-outline-variant bg-surface-container-low px-6 py-16 text-center">
      <ChartNoAxesColumn className="h-8 w-8 text-chrome-neutral-400" />
      <h2 className="text-base font-medium text-on-surface">{title}</h2>
      {body && <p className="max-w-md text-sm text-on-surface-variant">{body}</p>}
    </div>
  );
}

function LoadingCards() {
  const spans = ["col-span-12 h-36", "col-span-12 lg:col-span-8 h-64", "col-span-12 lg:col-span-4 h-64", "col-span-12 md:col-span-6 h-64", "col-span-12 md:col-span-6 h-64"];
  return (
    <>
      {spans.map((span) => (
        <div key={span} className={`${span} animate-pulse rounded-2xl border border-outline-variant bg-surface-container-low`} />
      ))}
    </>
  );
}

function RecapCards({ recap, onPlay }: { recap: RecapState; onPlay: (video: VideoSummary) => void }) {
  const open = useRecapLinks(onPlay);
  const { summary, period, source, index } = recap;
  if (!summary || !index) return null;
  if (isEmptySummary(summary)) return <EmptyPanel title={getString("recap_period_empty")} />;

  const showVideo = source !== "MUSIC" && (summary.video.views > 0 || summary.video.activity.totalMs > 0);
  const showMusic = source !== "VIDEO" && (summary.music.plays > 0 || summary.music.activity.totalMs > 0);
  const video = showVideo ? summary.video : null;
  const music = showMusic ? summary.music : null;
  const activity = summary.combined;
  const hasInsights = summary.insights.length > 0;
  const allTime = scopeOf(period) === "all";

  return (
    <>
      {summary.estimated && (
        <p className="col-span-12 flex items-start gap-2 text-sm text-on-surface-variant">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {getString("recap_estimate_note", dateLabel(index.startedAt))}
        </p>
      )}
      <OverviewCard summary={summary} activity={activity} source={source} />
      <TimeCard period={period} activity={activity} span={hasInsights ? "col-span-12 lg:col-span-8" : "col-span-12"} />
      {hasInsights && <InsightsCard summary={summary} />}
      <ClockCard activity={activity} />
      {scopeOf(period) === "month" && <CalendarCard month={period} activity={activity} />}
      <WeekdayCard activity={activity} />
      {video && <VideoRankCards video={video} onOpen={open} />}
      {music && <MusicRankCards music={music} onOpen={open} />}
      <FormatsCard video={video} music={music} />
      <DiscoveriesCard video={video} music={music} />
      <PassedOnCard video={video} music={music} onOpen={open} />
      {video && <LibraryCard video={video} />}
      {video && video.sponsorSavedMs > 0 && <SponsorCard video={video} />}
      {allTime && source !== "MUSIC" && index.historyChannels.length > 0 && (
        <HistoryCard channels={index.historyChannels} onOpen={open} />
      )}
    </>
  );
}

/** What was watched and listened to, month by month. Nothing here uses the network but portraits. */
export default function RecapPage({ onPlay }: { onPlay: (video: VideoSummary) => void }) {
  const [params] = useSearchParams();
  const recap = useRecap(params.get("period"));
  const months = recap.index?.months.map(([month]) => month) ?? [];
  const firstLoad = recap.loading && !recap.summary;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-6 pb-12 pt-8 md:px-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight text-chrome-neutral-100">{getString("recap_title")}</h1>
        <p className="mt-2 text-sm text-chrome-neutral-400">{getString("recap_summary")}</p>
      </header>
      <div className="grid grid-cols-12 gap-4">
        {recap.error ? (
          <div className="col-span-12 flex flex-col items-center gap-3 rounded-3xl border border-outline-variant bg-surface-container-low px-6 py-16 text-center">
            <h2 className="text-base font-medium text-on-surface">{getString("recap_load_failed")}</h2>
            <Button variant="secondary" size="sm" onClick={recap.retry}>{getString("retry")}</Button>
          </div>
        ) : firstLoad ? (
          <LoadingCards />
        ) : months.length === 0 ? (
          <EmptyPanel title={getString("recap_empty_title")} body={getString("recap_empty_body")} />
        ) : (
          <>
            <RecapControls
              months={months}
              period={recap.period}
              source={recap.source}
              onPeriod={recap.selectPeriod}
              onSource={recap.selectSource}
            />
            <RecapCards recap={recap} onPlay={onPlay} />
          </>
        )}
      </div>
    </div>
  );
}
