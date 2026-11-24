import { useMemo, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { CommentItem } from "./CommentItem";
import { buildCommentReplyTree, commentThreadRows, type CommentThreadLines } from "../../lib/commentThread";
import { getPlural, getString } from "../../lib/i18n/index";
import type { Comment } from "../../types/video";

// Flow for Android's thread geometry, in CSS pixels. Columns are measured from the comment's own
// start edge: column 0 is the top-level avatar, column N a reply indented N steps.
const COMMENT_AVATAR = 40;
const COMMENT_AVATAR_GAP = 12;
const REPLY_AVATAR = 24;
const REPLY_AVATAR_GAP = 8;
const REPLY_ROW_PADDING = 8;
const LINE_WIDTH = 1.5;
/** The space the elbow leaves before the avatar or label it turns into. */
const ELBOW_GAP = 4;
/** How far a label's button reaches back so its text, not its edge, lines up with the column. */
const LABEL_INSET = 8;

/** Where a row in `column` starts its avatar or label: one reply avatar and its gap per step. */
export function threadContentStart(column: number): number {
  return column === 0 ? 0 : COMMENT_AVATAR + COMMENT_AVATAR_GAP + (REPLY_AVATAR + REPLY_AVATAR_GAP) * (column - 1);
}

/** The start edge of the line of `column`, which runs down the centre of that column's avatar. */
const lineStart = (column: number) =>
  threadContentStart(column) + (column === 0 ? COMMENT_AVATAR : REPLY_AVATAR) / 2 - LINE_WIDTH / 2;

const LINE_CLASS = "pointer-events-none absolute border-s-[1.5px] border-outline-variant";

/**
 * One row's share of the thread lines, drawn behind it. Logical insets and borders, so a
 * right-to-left layout mirrors them with no code of its own. `elbowAtCentre` turns the elbow at the
 * row's middle, for a label row, instead of at the centre of a reply avatar.
 */
function ThreadLines({ lines, elbowAtCentre = false }: { lines: CommentThreadLines; elbowAtCentre?: boolean }) {
  const from = lineStart(lines.elbowFrom);
  const elbow: CSSProperties = {
    insetInlineStart: from,
    width: threadContentStart(lines.column) - ELBOW_GAP - from,
    height: elbowAtCentre ? `calc(50% + ${LINE_WIDTH / 2}px)` : REPLY_ROW_PADDING + REPLY_AVATAR / 2 + LINE_WIDTH / 2,
  };
  return (
    <>
      {lines.through.map((column) => (
        <span key={column} aria-hidden className={`${LINE_CLASS} inset-y-0`} style={{ insetInlineStart: lineStart(column) }} />
      ))}
      <span aria-hidden className={`${LINE_CLASS} top-0 rounded-es-lg border-b-[1.5px]`} style={elbow} />
      {lines.ownLine != null && (
        <span
          aria-hidden
          className={`${LINE_CLASS} bottom-0`}
          style={{ insetInlineStart: lineStart(lines.ownLine), top: REPLY_ROW_PADDING + REPLY_AVATAR }}
        />
      )}
    </>
  );
}

/** The line from a top-level comment's avatar down into its open replies. */
export function ThreadStem() {
  return <span aria-hidden className={`${LINE_CLASS} bottom-0`} style={{ insetInlineStart: lineStart(0), top: COMMENT_AVATAR }} />;
}

/** "3 replies ›" or "Show more replies", hanging off the thread line where a reply would. */
function ThreadLabelRow({
  lines,
  onClick,
  loading = false,
  children,
}: {
  lines: CommentThreadLines;
  onClick: () => void;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative flex items-center gap-2 py-1" style={{ paddingInlineStart: threadContentStart(lines.column) - LABEL_INSET }}>
      <ThreadLines lines={lines} elbowAtCentre />
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold text-primary transition-colors duration-200 ease-out hover:bg-surface-container-high"
      >
        {children}
      </button>
      {loading && <Loader2 className="animate-spin text-primary" size={14} />}
    </div>
  );
}

interface ReplyThreadProps {
  replies: Comment[];
  hasMore: boolean;
  loadingMore: boolean;
  isUnfolded: (commentId: string) => boolean;
  onUnfold: (commentId: string) => void;
  onLoadMore: () => void;
}

/**
 * The replies under one comment, drawn as the conversation they are. Every reply hangs off the line
 * that drops from the avatar it answered, one avatar column further in. YouTube sends a single flat
 * level, so who answered whom comes from the leading `@handle`; the tree is rebuilt whenever another
 * page of replies arrives.
 */
export function ReplyThread({ replies, hasMore, loadingMore, isUnfolded, onUnfold, onLoadMore }: ReplyThreadProps) {
  const tree = useMemo(() => buildCommentReplyTree(replies), [replies]);
  const rows = commentThreadRows(tree, hasMore, isUnfolded);
  return (
    <div className="pb-1">
      {rows.map((row) => {
        if (row.kind === "reply") {
          return (
            <div
              key={row.key}
              className="relative py-2"
              style={{ paddingInlineStart: threadContentStart(row.lines.column) }}
            >
              <ThreadLines lines={row.lines} />
              <CommentItem comment={row.comment} reply />
            </div>
          );
        }
        if (row.kind === "folded") {
          return (
            <ThreadLabelRow key={row.key} lines={row.lines} onClick={() => onUnfold(row.parentId)}>
              {getPlural("comments_folded_replies", row.count)}
              <ChevronRight size={16} className="rtl:-scale-x-100" />
            </ThreadLabelRow>
          );
        }
        return (
          <ThreadLabelRow key={row.key} lines={row.lines} onClick={onLoadMore} loading={loadingMore}>
            {getString("watch_show_more_replies")}
            <ChevronDown size={16} />
          </ThreadLabelRow>
        );
      })}
    </div>
  );
}
