// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment, CommentSort } from "../types/video";

const getComments = vi.fn();
vi.mock("./api/youtube", () => ({ getComments: (...args: unknown[]) => getComments(...args) }));
const { useTimedComments } = await import("./useTimedComments");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options: CommentSort[] = [
  { title: "Top", token: "top", selected: true },
  { title: "Newest", token: "new", selected: false },
];
const c = (id: string): Comment => ({ id, author: "a", text: "t" });

let hook: ReturnType<typeof useTimedComments>;
let root: Root;
function Probe({ active }: { active: boolean }) {
  hook = useTimedComments("v", options, active);
  return null;
}
const render = (active: boolean) => act(async () => root.render(createElement(Probe, { active })));

beforeEach(() => {
  getComments.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(async () => root.unmount()));

describe("useTimedComments", () => {
  it("reads nothing until Timed is chosen", async () => {
    await render(false);
    expect(getComments).not.toHaveBeenCalled();
  });

  it("reads both orders, newest first, into one list without repeats", async () => {
    getComments.mockImplementation(async (_v: string, token: string) =>
      token === "new" ? { comments: [c("a"), c("b")], nextPageToken: null } : { comments: [c("b"), c("d")], nextPageToken: "more" },
    );
    await render(true);
    expect(getComments.mock.calls[0]?.[1]).toBe("new");
    expect(hook.comments.map((x) => x.id)).toEqual(["a", "b", "d"]);
    // The top order keeps paging to its limit; the newest order ended after one page.
    expect(getComments.mock.calls.filter((call) => call[1] === "new")).toHaveLength(1);
    expect(hook.hasMore).toBe(true);
    expect(hook.loading).toBe(false);
  });

  it("stops at the opening limit and reads a little more on request", async () => {
    getComments.mockResolvedValue({ comments: [], nextPageToken: "next" });
    await render(true);
    expect(getComments).toHaveBeenCalledTimes(16);
    await act(async () => hook.loadMore());
    expect(getComments).toHaveBeenCalledTimes(20);
  });

  it("keeps what arrived when a page fails", async () => {
    getComments.mockResolvedValueOnce({ comments: [c("a")], nextPageToken: "n" }).mockRejectedValue(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await render(true);
    expect(hook.comments.map((x) => x.id)).toEqual(["a"]);
    expect(hook.loading).toBe(false);
    warn.mockRestore();
  });
});
