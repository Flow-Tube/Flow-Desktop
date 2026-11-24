import { describe, expect, it } from "vitest";
import { buildCommentReplyTree, commentThreadRows, type CommentReplyNode, type CommentThreadRow } from "./commentThread";
import type { Comment } from "../types/video";

const reply = (id: string, author: string, text: string): Comment => ({ id, author, text });

describe("arranging replies into a conversation", () => {
  it("hangs a reply that mentions an earlier reply off it", () => {
    const tree = buildCommentReplyTree([
      reply("r1", "@DaniDipp", "Source code I compile myself"),
      reply("r2", "@RachidBoudjelida", "SO basically we should throw everything"),
      reply("r3", "@skbs981", "@RachidBoudjelida and also by the governments"),
    ]);
    expect(tree.map((n) => n.comment.id)).toEqual(["r1", "r2"]);
    expect(tree[1]!.children.map((n) => n.comment.id)).toEqual(["r3"]);
  });

  it("leaves a mention of someone who has not replied at the top level", () => {
    const tree = buildCommentReplyTree([reply("r1", "@first", "@nobody hello"), reply("r2", "@second", "@alsoNobody hi")]);
    expect(tree.map((n) => n.comment.id)).toEqual(["r1", "r2"]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("never nests a reply under its own author", () => {
    const tree = buildCommentReplyTree([reply("r1", "@same", "first"), reply("r2", "@same", "@same talking to myself")]);
    expect(tree.map((n) => n.comment.id)).toEqual(["r1", "r2"]);
  });

  it("nests as deep as the conversation goes", () => {
    const tree = buildCommentReplyTree([
      reply("r1", "@a", "start"),
      reply("r2", "@b", "@a answering you"),
      reply("r3", "@c", "@b answering you"),
    ]);
    expect(tree.map((n) => n.comment.id)).toEqual(["r1"]);
    const second = tree[0]!.children[0]!;
    expect(second.comment.id).toBe("r2");
    expect(second.children[0]!.comment.id).toBe("r3");
  });

  it("only nests under someone who spoke earlier", () => {
    const tree = buildCommentReplyTree([reply("r1", "@a", "@b answering someone who has not replied yet"), reply("r2", "@b", "here I am")]);
    expect(tree.map((n) => n.comment.id)).toEqual(["r1", "r2"]);
  });

  it("still nests a mention behind a zero-width space", () => {
    const tree = buildCommentReplyTree([reply("r1", "@Kylek1986", "first"), reply("r2", "@GuruOfTheMoon", "​ @Kylek1986 same")]);
    expect(tree.map((n) => n.comment.id)).toEqual(["r1"]);
    expect(tree[0]!.children.map((n) => n.comment.id)).toEqual(["r2"]);
  });

  it("needs no tree for a single reply", () => {
    const tree = buildCommentReplyTree([reply("r1", "@a", "@a hello")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toEqual([]);
  });
});

const node = (id: string, ...children: CommentReplyNode[]): CommentReplyNode => ({
  comment: reply(id, `@${id}`, ""),
  children,
});
const rows = (nodes: CommentReplyNode[], { hasMore = false, unfolded = [] as string[] } = {}) =>
  commentThreadRows(nodes, hasMore, (id) => unfolded.includes(id));
const sorted = (lines: number[]) => [...lines].sort();
const asReply = (row: CommentThreadRow) => {
  if (row.kind !== "reply") throw new Error(`${row.key} is not a reply`);
  return row;
};

describe("laying a thread out in rows", () => {
  it("hangs top-level replies off the comment's line, which stops at the last one", () => {
    const result = rows([node("a"), node("b")]);
    expect(result.map((r) => r.key)).toEqual(["a", "b"]);
    expect(result[0]!.lines).toEqual({ column: 1, elbowFrom: 0, through: [0], ownLine: undefined });
    expect(result[1]!.lines).toEqual({ column: 1, elbowFrom: 0, through: [], ownLine: undefined });
  });

  it("keeps the line running to the load more row while YouTube has more", () => {
    const result = rows([node("a")], { hasMore: true });
    expect(result[0]!.lines.through).toEqual([0]);
    const more = result[result.length - 1]!;
    expect(more.kind).toBe("more");
    expect(more.lines).toEqual({ column: 1, elbowFrom: 0, through: [] });
  });

  it("shows a reply's own replies at once, one column in, off the reply's avatar", () => {
    const result = rows([node("a", node("a1")), node("b")]);
    expect(result.map((r) => r.key)).toEqual(["a", "a1", "b"]);
    expect(result[0]!.lines.ownLine).toBe(1);
    expect(asReply(result[1]!).depth).toBe(2);
    expect(result[1]!.lines).toEqual({ column: 2, elbowFrom: 1, through: [0], ownLine: undefined });
  });

  it("folds deeper replies behind a count until they are unfolded", () => {
    const tree = node("a", node("a1", node("a11", node("a111")), node("a12")));
    const folded = rows([tree]);
    expect(folded.map((r) => r.key)).toEqual(["a", "a1", "folded_a1"]);
    const label = folded[folded.length - 1]!;
    expect(label.kind === "folded" && label.count).toBe(3);
    expect(label.lines).toEqual({ column: 3, elbowFrom: 2, through: [] });

    const open = rows([tree], { unfolded: ["a1"] });
    expect(open.map((r) => r.key)).toEqual(["a", "a1", "a11", "folded_a11", "a12"]);
    expect(open[2]!.lines).toEqual({ column: 3, elbowFrom: 2, through: [2], ownLine: undefined });
  });

  it("stops indenting at the last column, where deeper replies share their parent's line", () => {
    const result = rows([node("a", node("b", node("c", node("d", node("e")))))], { unfolded: ["b", "c", "d"] });
    expect(result.map((r) => r.key)).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.map((r) => r.lines.column)).toEqual([1, 2, 3, 3, 3]);
    const c = result[2]!.lines;
    expect(c.elbowFrom).toBe(2);
    expect(c.ownLine).toBeUndefined();
    expect(c.through).toContain(2);
    expect(result[3]!.lines.elbowFrom).toBe(2);
    expect(result[4]!.lines.elbowFrom).toBe(2);
    expect(result[4]!.lines.through).toEqual([]);
  });

  it("runs an ancestor's line past every row of a branch with a later sibling", () => {
    const result = rows([node("a", node("a1"), node("a2")), node("b")]);
    expect(result.map((r) => r.key)).toEqual(["a", "a1", "a2", "b"]);
    expect(sorted(result[1]!.lines.through)).toEqual([0, 1]);
    expect(result[2]!.lines.through).toEqual([0]);
  });
});
