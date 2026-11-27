import { describe, expect, it } from "vitest";
import { parseFlowUrl } from "./flowHandoff";
import { OPEN_IN_FLOW_BOOKMARKLET } from "./openInFlowLinks";

/** What the bookmark navigates to when clicked on `href`. */
function clickBookmark(href: string): string {
  const page = { href };
  new Function("location", OPEN_IN_FLOW_BOOKMARKLET.slice("javascript:".length))(page);
  return page.href;
}

describe("Open in Flow bookmark", () => {
  it("sends the YouTube page it is clicked on to Flow", () => {
    const link = clickBookmark("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij&t=42");
    expect(link.startsWith("flow://open?url=")).toBe(true);
    expect(parseFlowUrl(link)).toEqual({ action: "watch", v: "dQw4w9WgXcQ", t: 42, list: "PLabcdefghij" });
  });

  it("hands Flow a page that isn't YouTube, which Flow ignores", () => {
    expect(parseFlowUrl(clickBookmark("https://example.com/watch?v=dQw4w9WgXcQ"))).toBeNull();
  });
});
