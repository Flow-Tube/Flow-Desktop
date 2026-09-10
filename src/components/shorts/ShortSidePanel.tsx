import { X } from "lucide-react";
import { CommentsSection } from "../watch/CommentsSection";
import { useShortDetails } from "../../lib/useShortDetails";
import { linkifyText } from "../../lib/linkify";
import { getString } from "../../lib/i18n/index";
import { formatCount } from "../../lib/utils";
import type { ShortItem, ShortsPanelState } from "../../types/shorts";
import type { VideoDetails } from "../../types/video";
import type { RydData } from "../../lib/api/foss";

interface ShortSidePanelProps {
  short: ShortItem;
  details?: VideoDetails | null;
  rydData?: RydData | null;
  commentCountText?: string | null;
  panelState: ShortsPanelState;
  onClose: () => void;
}

export function ShortSidePanel({
  short,
  details,
  rydData,
  commentCountText,
  panelState,
  onClose,
}: ShortSidePanelProps) {
  const isComments = panelState === "comments";
  const headerCountText = isComments ? formatCount(commentCountText ?? short.commentCountText) : "";

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <div className="flex items-center justify-between border-b border-chrome-neutral-800 p-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="text-base font-medium text-chrome-neutral-200">
            {getString(isComments ? "shorts_comments_title" : "shorts_description_title")}
          </h3>
          {headerCountText && (
            <span className="text-sm font-semibold text-chrome-neutral-400">{headerCountText}</span>
          )}
        </div>
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-100"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {isComments ? (
        <ShortComments videoId={short.id} />
      ) : (
        <ShortDescription
          short={short}
          details={details}
          rydData={rydData}
          commentCountText={commentCountText}
        />
      )}
    </div>
  );
}

function ShortDescription({
  short,
  details,
  rydData,
  commentCountText,
}: {
  short: ShortItem;
  details?: VideoDetails | null;
  rydData?: RydData | null;
  commentCountText?: string | null;
}) {
  const { details: fetchedDetails, loading } = useShortDetails(short.id, !details);
  const resolvedDetails = details ?? fetchedDetails;
  const description = resolvedDetails?.description?.trim();
  const title = short.title.trim() && short.title !== "Short" ? short.title : resolvedDetails?.title || short.title;
  const likes = rydData
    ? formatCount(rydData.likes)
    : formatCount(short.likeCountText ?? resolvedDetails?.likeCountText) || "-";
  const dislikes = rydData ? formatCount(rydData.dislikes) : "-";
  const views = formatCount(short.viewCountText ?? resolvedDetails?.viewCountText) || "-";
  const comments = formatCount(commentCountText ?? short.commentCountText) || "-";

  return (
    <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
      <div className="grid grid-cols-2 gap-2 p-4">
        <StatPill label={getString("shorts_stat_likes")} value={likes} />
        <StatPill label="Dislikes" value={dislikes} />
        <StatPill label={getString("shorts_stat_views")} value={views} />
        <StatPill label={getString("shorts_comments_title")} value={comments} />
      </div>
      <p className="px-4 text-base font-medium text-chrome-neutral-100">{title}</p>
      <p className="whitespace-pre-wrap p-4 text-sm text-chrome-neutral-300">
        {description ? linkifyText(description) : loading ? "..." : getString("shorts_no_description")}
      </p>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl bg-surface-container-low p-3">
      <span className="max-w-full truncate font-mono text-sm text-chrome-neutral-100">{value}</span>
      <span className="mt-0.5 text-xs text-chrome-neutral-400">{label}</span>
    </div>
  );
}

function ShortComments({ videoId }: { videoId: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
        <CommentsSection videoId={videoId} hideHeader />
      </div>
    </div>
  );
}
