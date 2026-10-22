import { useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, XCircle } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { upgradeCommunityPostImageUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useRichTargetHandler } from "../../lib/useRichTargetHandler";
import type { PollChoice, PostAttachment as Attachment, QuizChoice, VideoSummary } from "../../types/video";

function Gallery({ urls }: { urls: string[] }) {
  const [index, setIndex] = useState(0);
  const src = useProxiedImageUrl(upgradeCommunityPostImageUrl(urls[index]));
  const many = urls.length > 1;
  const step = (by: number) => setIndex((current) => (current + by + urls.length) % urls.length);
  return (
    <div className="relative mb-4 flex max-h-[720px] w-full items-center justify-center overflow-hidden rounded-xl border border-chrome-neutral-800 bg-surface-container-low">
      {src && (
        <img
          src={src}
          alt={getString("post_image_alt", index + 1, urls.length)}
          className="max-h-[720px] w-full object-contain"
          loading="lazy"
        />
      )}
      {many && (
        <>
          <button
            type="button"
            aria-label={getString("post_gallery_previous")}
            onClick={() => step(-1)}
            className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-surface-container-high text-chrome-neutral-100 transition-colors hover:bg-surface-container-highest"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            aria-label={getString("post_gallery_next")}
            onClick={() => step(1)}
            className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-surface-container-high text-chrome-neutral-100 transition-colors hover:bg-surface-container-highest"
          >
            <ChevronRight size={18} />
          </button>
          <span className="absolute bottom-2 right-2 rounded-full bg-surface-container-high px-2 py-0.5 text-xs font-semibold text-chrome-neutral-200">
            {index + 1} / {urls.length}
          </span>
        </>
      )}
    </div>
  );
}

function Poll({ choices, totalVotesText }: { choices: PollChoice[]; totalVotesText?: string | null }) {
  return (
    <div className="mb-4 space-y-2">
      {choices.map((choice) => (
        <div
          key={choice.text}
          className="relative overflow-hidden rounded-lg border border-chrome-neutral-800 px-3 py-2 text-sm text-chrome-neutral-100"
        >
          {choice.voteRatio != null && (
            <div
              className="absolute inset-y-0 left-0 bg-surface-container-high"
              style={{ width: `${Math.round(choice.voteRatio * 100)}%` }}
            />
          )}
          <div className="relative flex items-center justify-between gap-3">
            <span>{choice.text}</span>
            {choice.voteRatio != null && (
              <span className="shrink-0 font-semibold text-chrome-neutral-300">
                {Math.round(choice.voteRatio * 100)}%
              </span>
            )}
          </div>
        </div>
      ))}
      {totalVotesText && <p className="text-xs text-chrome-neutral-500">{totalVotesText}</p>}
    </div>
  );
}

/** A quiz keeps its answer hidden until a choice is picked, as on the site. */
function Quiz({ choices, totalVotesText }: { choices: QuizChoice[]; totalVotesText?: string | null }) {
  const [picked, setPicked] = useState<number | null>(null);
  const answer = picked === null ? null : choices[picked];
  return (
    <div className="mb-4 space-y-2">
      {choices.map((choice, index) => {
        const revealed = picked !== null && (choice.isCorrect || index === picked);
        const tone = !revealed
          ? "border-chrome-neutral-800 hover:bg-surface-container-high"
          : choice.isCorrect
            ? "border-[var(--color-primary)] text-chrome-neutral-100"
            : "border-chrome-neutral-600 text-chrome-neutral-400";
        return (
          <button
            key={choice.text}
            type="button"
            disabled={picked !== null}
            onClick={() => setPicked(index)}
            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm text-chrome-neutral-100 transition-colors ${tone}`}
          >
            <span>{choice.text}</span>
            {revealed &&
              (choice.isCorrect ? (
                <CheckCircle2 size={18} className="shrink-0 text-[var(--color-primary)]" />
              ) : (
                <XCircle size={18} className="shrink-0 text-chrome-neutral-500" />
              ))}
          </button>
        );
      })}
      {answer && (
        <p className="text-sm text-chrome-neutral-300">
          <span className="font-semibold text-chrome-neutral-100">
            {getString(answer.isCorrect ? "post_quiz_correct" : "post_quiz_wrong")}
          </span>
          {answer.explanation ? ` ${answer.explanation}` : ""}
        </p>
      )}
      {totalVotesText && <p className="text-xs text-chrome-neutral-500">{totalVotesText}</p>}
    </div>
  );
}

function SharedVideo({ video }: { video: VideoSummary }) {
  const open = useRichTargetHandler();
  const thumbnail = useProxiedImageUrl(video.thumbnailUrl);
  return (
    <button
      type="button"
      onClick={() => open({ kind: "video", videoId: video.id })}
      className="mb-4 flex w-full items-center gap-3 rounded-xl border border-chrome-neutral-800 p-2 text-left transition-colors hover:bg-surface-container-high"
    >
      <div className="aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-surface-container-high">
        {thumbnail && <img src={thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />}
      </div>
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-semibold text-chrome-neutral-100">{video.title}</p>
        <p className="truncate text-xs text-chrome-neutral-400">
          {[video.channelName, video.viewCountText].filter(Boolean).join(" · ")}
        </p>
      </div>
    </button>
  );
}

export function PostAttachment({ attachment }: { attachment: Attachment }) {
  switch (attachment.kind) {
    case "images":
      return <Gallery urls={attachment.urls} />;
    case "poll":
      return <Poll choices={attachment.choices} totalVotesText={attachment.totalVotesText} />;
    case "quiz":
      return <Quiz choices={attachment.choices} totalVotesText={attachment.totalVotesText} />;
    case "video":
      return <SharedVideo video={attachment.video} />;
  }
}
