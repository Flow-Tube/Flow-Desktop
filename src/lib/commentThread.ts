import type { Comment } from "../types/video";

/** A reply and whatever replied to it, at the depth it sits in the conversation. */
export interface CommentReplyNode {
  comment: Comment;
  children: CommentReplyNode[];
}

// A leading mention can sit behind a zero-width space, which \s does not match.
const LEADING_MENTION = /^[\s​‌‍⁠﻿]*@([^\s,:​]+)/;

/**
 * Arranges a flat reply list into the conversation it actually is.
 *
 * YouTube stores one level of replies: a reply to a reply comes back in the same list, marked only
 * by the `@handle` it opens with. A mention only nests a reply under someone who already spoke
 * earlier in the thread, so a mention of the top-level author, of a stranger, or of someone further
 * down leaves the reply where it is. Ported from Flow for Android.
 */
export function buildCommentReplyTree(replies: Comment[]): CommentReplyNode[] {
  if (replies.length < 2) return replies.map((comment) => ({ comment, children: [] }));

  const children = new Map<string, Comment[]>();
  const roots: Comment[] = [];
  const seenAuthors = new Map<string, string>();

  for (const reply of replies) {
    const handle = reply.author.trim().replace(/^@/, "").toLowerCase();
    const mention = LEADING_MENTION.exec(reply.text)?.[1]?.toLowerCase();
    // Answering yourself is a continuation, not a branch, so it stays where it is.
    const parentId = mention && mention !== handle ? seenAuthors.get(mention) : undefined;
    if (parentId) children.set(parentId, [...(children.get(parentId) ?? []), reply]);
    else roots.push(reply);
    if (!seenAuthors.has(handle)) seenAuthors.set(handle, reply.id);
  }

  const node = (comment: Comment): CommentReplyNode => ({
    comment,
    children: (children.get(comment.id) ?? []).map(node),
  });
  return roots.map(node);
}

/** Indentation stops here so a deep conversation never squeezes the text out of a narrow panel. */
export const MAX_THREAD_COLUMN = 3;

/** Replies down to this depth show up when a thread opens; deeper ones wait behind "N replies". */
export const OPEN_THREAD_DEPTH = 2;

/**
 * The thread lines one row draws, by column. Column 0 is the top-level comment's avatar; column N
 * is the avatar of a reply indented N steps.
 */
export interface CommentThreadLines {
  /** Where the row's own avatar or label starts. */
  column: number;
  /** The line that turns into this row. */
  elbowFrom: number;
  /** Lines that pass the row from top to bottom on their way to later rows. */
  through: number[];
  /** The line that drops from this row's avatar into its replies. */
  ownLine?: number;
}

export type CommentThreadRow =
  | { kind: "reply"; key: string; comment: Comment; depth: number; lines: CommentThreadLines }
  /** The replies to `parentId` while they are folded away. */
  | { kind: "folded"; key: string; parentId: string; count: number; lines: CommentThreadLines }
  /** YouTube has another page of replies. */
  | { kind: "more"; key: string; lines: CommentThreadLines };

const descendantCount = (node: CommentReplyNode): number =>
  node.children.reduce((sum, child) => sum + 1 + descendantCount(child), 0);

const withLine = (lines: number[], line: number) => (lines.includes(line) ? lines : [...lines, line]);

/**
 * Lays a reply tree out as the rows the thread draws, top to bottom, with the lines each one owns.
 * A reply at [MAX_THREAD_COLUMN] or deeper stays in that column, and its replies hang off the same
 * line it hangs off, so the elbows keep turning in from the start side however deep the talk goes.
 */
export function commentThreadRows(
  nodes: CommentReplyNode[],
  hasMore: boolean,
  isUnfolded: (commentId: string) => boolean,
): CommentThreadRow[] {
  const rows: CommentThreadRow[] = [];

  const visit = (siblings: CommentReplyNode[], depth: number, inherited: number[], followedByMore: boolean) => {
    const parentLine = Math.min(depth - 1, MAX_THREAD_COLUMN - 1);
    const childLine = Math.min(depth, MAX_THREAD_COLUMN - 1);
    const column = Math.min(depth, MAX_THREAD_COLUMN);
    siblings.forEach((node, index) => {
      const last = index === siblings.length - 1 && !followedByMore;
      const hasReplies = node.children.length > 0;
      const sharesParentLine = hasReplies && childLine === parentLine;
      rows.push({
        kind: "reply",
        key: node.comment.id,
        comment: node.comment,
        depth,
        lines: {
          column,
          elbowFrom: parentLine,
          through: !last || sharesParentLine ? withLine(inherited, parentLine) : inherited,
          ownLine: hasReplies && !sharesParentLine ? column : undefined,
        },
      });
      if (!hasReplies) return;
      const below = last ? inherited : withLine(inherited, parentLine);
      if (depth < OPEN_THREAD_DEPTH || isUnfolded(node.comment.id)) {
        visit(node.children, depth + 1, below, false);
      } else {
        rows.push({
          kind: "folded",
          key: `folded_${node.comment.id}`,
          parentId: node.comment.id,
          count: descendantCount(node),
          lines: { column: Math.min(depth + 1, MAX_THREAD_COLUMN), elbowFrom: childLine, through: below },
        });
      }
    });
  };

  visit(nodes, 1, [], hasMore);
  if (hasMore) rows.push({ kind: "more", key: "more_replies", lines: { column: 1, elbowFrom: 0, through: [] } });
  return rows;
}
