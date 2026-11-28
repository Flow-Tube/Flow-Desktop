import { useMemo, useState, type CSSProperties } from "react";
import { Copy } from "lucide-react";
import { formatCount } from "../../lib/utils";
import { getString } from "../../lib/i18n/index";
import { hasTextSelection } from "../../lib/textSelection";
import { copyText } from "../../lib/clipboard";
import { SETTINGS } from "../../lib/settings/schema";
import { useDominantColor, type Rgb } from "../../lib/useDominantColor";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { IconButton } from "../ui/IconButton";
import { DescriptionBody } from "./DescriptionBody";
import { DescriptionExtras } from "./DescriptionExtras";
import { DescriptionSummary } from "./DescriptionSummary";
import { DescriptionTags } from "./DescriptionTags";
import { linkifyPlain } from "../../lib/richText";
import { useOriginalTitlesEnabled } from "../../lib/useOriginalTitle";
import type { DescriptionCardProps } from "./types";

// A live stream's count is YouTube's own "197 watching now", shown as sent.
const formatViews = (views: string | number | null | undefined, isLive: boolean) => {
  if (isLive && typeof views === "string" && views) return views;
  return getString("watch_view_count", views ? formatCount(views) : "0");
};

async function copyDescription(description: string) {
  const copied = await copyText(description);
  useUiStore.getState().showToast({
    variant: copied ? "success" : "error",
    message: getString(copied ? "watch_description_copied" : "watch_description_copy_failed"),
  });
}

/**
 * The card's surfaces and link colour. By default they are the theme's panel surfaces; with
 * Tint the description on they take the thumbnail's colour, as Flow for Android's cards do.
 */
function surfaceVariables(tint: Rgb | null): CSSProperties {
  if (!tint) {
    return {
      "--desc-container": "var(--color-surface-row)",
      "--desc-raised": "var(--color-surface-row-control)",
    } as CSSProperties;
  }
  const color = `rgb(${tint.r} ${tint.g} ${tint.b})`;
  return {
    "--desc-container": `color-mix(in srgb, ${color} 16%, var(--color-surface-row))`,
    "--desc-raised": `color-mix(in srgb, ${color} 28%, var(--color-surface-row))`,
    "--rich-link": `color-mix(in srgb, ${color} 55%, var(--color-on-surface))`,
  } as CSSProperties;
}

/**
 * The description under the video, laid out as Flow for Android's description: the headline
 * numbers, the text with its links and video cards, then hashtags, songs, how it was made, the
 * chapters and transcript, the channel and the tags. Collapsed, it shows the views, the date and
 * the first lines.
 */
export function DescriptionCard({ currentVideo, videoData }: DescriptionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const tintEnabled = useAppSettingsStore((s) => s.values[SETTINGS.DESCRIPTION_TINT_ENABLED] === "true");
  const summariesEnabled = useAppSettingsStore((s) => s.values[SETTINGS.AI_SUMMARIES_ENABLED] === "true");
  const thumbnail = useProxiedImageUrl(tintEnabled ? currentVideo.thumbnailUrl ?? videoData?.thumbnailUrl ?? null : null);
  const tint = useDominantColor(thumbnail);

  const originalTitles = useOriginalTitlesEnabled();
  const rich = videoData?.descriptionRich;
  // YouTube's formatted description, with its short link text, site icons and chips, as Flow for
  // Android shows it. It can be a translation, so Original titles keeps the player's own text.
  const value = useMemo(() => {
    const plain = videoData?.description || "";
    return rich && (!originalTitles || rich.text === plain) ? rich : linkifyPlain(plain);
  }, [originalTitles, rich, videoData?.description]);
  const description = value.text;
  const viewCount = videoData?.viewCountText || currentVideo.viewCountText || null;
  const published = videoData?.publishedText || currentVideo.publishedText || "";
  const factoids = videoData?.descriptionExtras?.factoids ?? [];
  const showFactoids = expanded && factoids.length > 0;
  const summary = summariesEnabled ? videoData?.descriptionExtras?.summary : null;

  return (
    <div
      onClick={() => {
        if (!expanded && !hasTextSelection()) setExpanded(true);
      }}
      style={surfaceVariables(tintEnabled ? tint : null)}
      className={`flex flex-col gap-4 rounded-2xl bg-[var(--desc-container)] p-4 text-sm transition-colors duration-300 ease-out ${expanded ? "" : "cursor-pointer"}`}
    >
      {showFactoids ? (
        <div className="flex items-start gap-2">
          <div className="grid flex-1 grid-cols-3 gap-2">
            {factoids.slice(0, 3).map((factoid) => (
              <div key={`${factoid.label}-${factoid.value}`} className="flex flex-col items-center gap-0.5 rounded-2xl bg-[var(--desc-raised)] px-2 py-3.5 text-center">
                <span className="text-lg font-bold tabular-nums text-chrome-neutral-100">{factoid.value}</span>
                <span className="text-xs text-chrome-neutral-400">{factoid.label}</span>
              </div>
            ))}
          </div>
          {description && <CopyButton description={description} />}
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 font-medium text-chrome-neutral-200">
            <span>{formatViews(viewCount, Boolean(videoData?.isLive))}</span>
            {published && (
              <span className="text-chrome-neutral-400" title={videoData?.relativePublishedText ?? undefined}>
                {" • "}{published}
              </span>
            )}
            {!expanded && description && <span className="font-bold text-chrome-neutral-100"> {getString("description_more")}</span>}
          </p>
          {expanded && description && <CopyButton description={description} />}
        </div>
      )}

      {summary && summary.paragraphs.length > 0 && <DescriptionSummary summary={summary} expanded={expanded} />}

      {description ? (
        <DescriptionBody value={value} videoId={currentVideo.id} expanded={expanded} />
      ) : (
        <span className="text-chrome-neutral-500">{getString("watch_no_description")}</span>
      )}

      {expanded && (
        <>
          <DescriptionExtras
            videoId={currentVideo.id}
            extras={videoData?.descriptionExtras}
            hashtags={videoData?.hashtags ?? []}
            chapterCount={videoData?.chapters?.length ?? 0}
          />
          <DescriptionTags tags={videoData?.tags} category={videoData?.category} />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(false);
            }}
            className="self-start font-medium text-chrome-neutral-400 transition-colors duration-200 ease-out hover:text-chrome-neutral-100"
          >
            {getString("watch_show_less")}
          </button>
        </>
      )}
    </div>
  );
}

function CopyButton({ description }: { description: string }) {
  return (
    <IconButton
      size="sm"
      aria-label={getString("watch_copy_description")}
      title={getString("watch_copy_description")}
      onClick={(event) => {
        event.stopPropagation();
        void copyDescription(description);
      }}
    >
      <Copy className="h-4 w-4" />
    </IconButton>
  );
}
