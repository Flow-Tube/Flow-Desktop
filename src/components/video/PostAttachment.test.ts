import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostAttachment } from "./PostAttachment";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/playlistLibrary", async (actual) => ({
  ...(await actual<typeof import("../../lib/playlistLibrary")>()),
  isPlaylistInLibrary: vi.fn(async () => false),
}));

let root: Root | null = null;
const host = document.createElement("div");

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("PostAttachment", () => {
  it("draws a shared playlist as a playlist card", async () => {
    const attachment = {
      kind: "playlist" as const,
      playlist: { id: "PLsynthetic01", title: "Bench builds", videoCountText: "12 videos" },
    };
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(MemoryRouter, null, createElement(PostAttachment, { attachment })));
    });
    expect(host.textContent).toContain("Bench builds");
    expect(host.textContent).toContain("12 videos");
  });
});
