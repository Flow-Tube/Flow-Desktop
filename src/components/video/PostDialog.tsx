import { useState } from "react";
import { getString } from "../../lib/i18n/index";
import { InfoDialog } from "../ui/InfoDialog";
import { CommentsSection } from "../watch/CommentsSection";
import { LinkedText } from "../watch/LinkedText";
import { PostAttachment } from "./PostAttachment";
import { PostActions, PostAuthor } from "./PostParts";
import type { PostSummary } from "../../types/video";

interface PostDialogProps {
  post: PostSummary;
  /** Opened from the comment count, so the comments show straight away. */
  initialCommentsOpen: boolean;
  onClose: () => void;
}

/** The whole post a shelf card only previews: full text, every image, the poll and its comments. */
export function PostDialog({ post, initialCommentsOpen, onClose }: PostDialogProps) {
  const [commentsOpen, setCommentsOpen] = useState(initialCommentsOpen);
  return (
    <InfoDialog title={getString("post_dialog_title")} closeLabel={getString("close")} onClose={onClose} wide>
      <PostAuthor post={post} className="mb-3" />
      {post.textContent && (
        <LinkedText
          text={post.textContent}
          className="mb-3 block select-text whitespace-pre-wrap text-sm font-medium leading-relaxed text-chrome-zinc-100"
        />
      )}
      {post.attachment && <PostAttachment attachment={post.attachment} />}
      <PostActions
        post={post}
        commentsOpen={commentsOpen}
        onComments={() => setCommentsOpen((open) => !open)}
        className="mt-3"
      />
      {commentsOpen && (
        <div className="mt-6 border-t border-chrome-neutral-800">
          <CommentsSection videoId="" postId={post.id} postCommentParams={post.commentEndpointParams} />
        </div>
      )}
    </InfoDialog>
  );
}
