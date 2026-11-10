import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getString } from "../../lib/i18n/index";
import type { LikedItem } from "../../store/useLikesStore";
import { LikesFlatList } from "./LikesFlatList";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const liked = {
  kind: "video",
  id: "vid00000001",
  likedAt: "2026-01-01T00:00:00.000Z",
  video: { id: "vid00000001", title: "A video", channelName: "A channel", thumbnailUrl: "" },
} as unknown as LikedItem;

describe("LikesFlatList", () => {
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

  it("lets a video row be removed from its menu", async () => {
    const onRemove = vi.fn();
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(LikesFlatList, {
      items: [liked],
      selecting: false,
      selectedKeys: new Set<string>(),
      onToggle: vi.fn(),
      onPlay: vi.fn(),
      onRemove,
    }))));

    await act(async () => {
      host.querySelector("div.group")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    });
    const remove = [...document.body.querySelectorAll<HTMLElement>("button, [role='menuitem']")]
      .find((element) => element.textContent?.trim() === getString("remove"));
    await act(async () => remove!.click());

    expect(onRemove).toHaveBeenCalledWith(liked);
  });
});
