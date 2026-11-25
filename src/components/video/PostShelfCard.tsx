import { useState, type ComponentType } from "react";
import { CircleHelp, Images, ListChecks, ListVideo, Play } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { joinIsolated } from "../../lib/direction";
import { upgradeCommunityPostImageUrl } from "../../lib/thumbnails";
import { imageSizeStep } from "../../lib/thumbnailTiers";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { PostDialog } from "./PostDialog";
import { PostActions, PostAuthor } from "./PostParts";
import type { PostAttachment, PostSummary } from "../../types/video";

// The thumbnail's `h-28 w-28`.
const THUMB_PX = 112;

interface Preview {
  url: string | null | undefined;
  icon: ComponentType<{ size?: number }>;
  /** Beside the icon, such as how many pictures the post has. */
  badge?: string;
}

function previewOf(attachment: PostAttachment | null | undefined): Preview | null {
  switch (attachment?.kind) {
    case "images":
      return {
        url: upgradeCommunityPostImageUrl(attachment.urls[0], imageSizeStep(THUMB_PX)),
        icon: Images,
        badge: attachment.urls.length > 1 ? String(attachment.urls.length) : undefined,
      };
    case "video":
      return { url: attachment.video.thumbnailUrl, icon: Play };
    case "playlist":
      return { url: attachment.playlist.thumbnailUrl, icon: ListVideo };
    default:
      return null;
  }
}

function PreviewThumb({ preview }: { preview: Preview }) {
  const src = useProxiedImageUrl(preview.url);
  const Icon = preview.icon;
  return (
    <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-surface-container-low">
      {src && <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />}
      <span className="absolute bottom-1.5 end-1.5 flex items-center gap-1 rounded-full bg-chrome-black/70 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-chrome-white">
        <Icon size={12} />
        {preview.badge}
      </span>
    </div>
  );
}

/** A poll or quiz can't fit a fixed card, so the card names it and the dialog shows it. */
function ChoicesLine({ attachment }: { attachment: PostAttachment }) {
  if (attachment.kind !== "poll" && attachment.kind !== "quiz") return null;
  const Icon = attachment.kind === "poll" ? ListChecks : CircleHelp;
  const label = getString(attachment.kind === "poll" ? "post_poll" : "post_quiz");
  return (
    <span className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-chrome-neutral-400">
      <Icon size={14} />
      {joinIsolated([label, attachment.totalVotesText], " · ")}
    </span>
  );
}

/**
 * A post as one same-sized card in a shelf: clamped text with any picture, video or playlist
 * as a small square at the end. Opening it shows the whole post in a dialog.
 */
export function PostShelfCard({ post }: { post: PostSummary }) {
  const [open, setOpen] = useState<"post" | "comments" | null>(null);
  const preview = previewOf(post.attachment);
  const hasChoices = post.attachment?.kind === "poll" || post.attachment?.kind === "quiz";

  return (
    <article className="flex h-[244px] w-full flex-col rounded-2xl border border-chrome-zinc-800/60 bg-surface p-4 transition-colors duration-200 ease-out hover:border-chrome-zinc-700/80">
      <PostAuthor post={post} className="mb-3" />

      <button
        type="button"
        onClick={() => setOpen("post")}
        aria-label={getString("post_open")}
        className="flex min-h-0 flex-1 items-start gap-4 rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          {post.textContent && (
            <span
              dir="auto"
              className={`whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-chrome-zinc-100 ${hasChoices ? "line-clamp-3" : "line-clamp-4"}`}
            >
              {post.textContent}
            </span>
          )}
          {post.attachment && <ChoicesLine attachment={post.attachment} />}
        </span>
        {preview && <PreviewThumb preview={preview} />}
      </button>

      <PostActions
        post={post}
        commentsOpen={open === "comments"}
        onComments={() => setOpen("comments")}
        className="mt-3"
      />

      {open && (
        <PostDialog post={post} initialCommentsOpen={open === "comments"} onClose={() => setOpen(null)} />
      )}
    </article>
  );
}
