import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/useVideoThumbnail", () => ({
  useVideoThumbnail: () => ({ src: null, onError: vi.fn() }),
}));

import { PlaylistAmbientHeader } from "./PlaylistAmbientHeader";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const meta = {
  id: "p",
  title: "Mine",
  description: "My notes",
  channelName: "Flow",
  viewCountText: null,
  videoCount: 2,
  videoCountText: "2 videos",
  thumbnailUrl: null,
  updatedLabel: "Updated today",
};

describe("PlaylistAmbientHeader", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (props: Partial<Parameters<typeof PlaylistAmbientHeader>[0]>) =>
    act(() => {
      root.render(
        createElement(PlaylistAmbientHeader, {
          meta,
          heroThumbnailUrl: null,
          canPlay: true,
          onPlayAll: vi.fn(),
          onShuffle: vi.fn(),
          onEdit: vi.fn(),
          onAddAll: vi.fn(),
          ...props,
        }),
      );
    });

  const openMenu = () =>
    act(() => {
      (host.querySelector('[aria-label="Playlist menu"]') as HTMLButtonElement).click();
    });

  it("offers Edit and Merge on a playlist you own, and shows its description", () => {
    render({ isOwned: true, isSaved: true });
    openMenu();
    expect(document.body.textContent).toContain("Edit playlist");
    expect(document.body.textContent).toContain("Merge into another playlist");
    expect(host.textContent).toContain("My notes");
  });

  it("offers Add to my playlist, without Edit, on someone else's playlist", () => {
    render({ isOwned: false });
    openMenu();
    expect(document.body.textContent).not.toContain("Edit playlist");
    expect(document.body.textContent).toContain("Add to my playlist");
    expect(host.textContent).not.toContain("My notes");
  });

  it("notes hidden videos only when told to", () => {
    render({});
    expect(host.textContent).not.toContain("Unavailable videos are hidden");
    render({ hidesUnavailable: true });
    expect(host.textContent).toContain("Unavailable videos are hidden");
  });
});
