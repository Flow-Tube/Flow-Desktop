import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./LiveChat", () => ({
  LiveChat: ({ isReplay, onClose }: { isReplay?: boolean; onClose?: () => void }) =>
    createElement("div", { "data-testid": "live-chat" }, [
      createElement("span", { key: "label" }, isReplay ? "Chat replay" : "Live chat"),
      onClose && createElement("button", { key: "close", "data-testid": "close-chat-btn", onClick: onClose }, "Close"),
    ]),
}));

vi.mock("../player/chapters", () => ({
  Chapters: () => createElement("div", { "data-testid": "chapters" }),
}));

vi.mock("../player/QueuePanel", () => ({
  QueuePanel: () => createElement("div", { "data-testid": "queue" }),
}));

import { usePlayerStore } from "../../store/usePlayerStore";
import { WatchSidePanels } from "./WatchSidePanels";

describe("WatchSidePanels chat replay toggle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    usePlayerStore.getState().setIsLiveChatOpen(true);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    usePlayerStore.getState().setIsLiveChatOpen(true);
  });

  it("renders live chat with a close handler when chat is open", () => {
    act(() => {
      root.render(
        createElement(WatchSidePanels, {
          videoId: "test-vid",
          chat: { isReplay: true },
          chapters: [],
          autoChapters: false,
        }),
      );
    });

    const chatEl = container.querySelector("[data-testid='live-chat']");
    expect(chatEl).not.toBeNull();
    expect(container.querySelector("[data-testid='close-chat-btn']")).not.toBeNull();
    expect(usePlayerStore.getState().isLiveChatAvailable).toBe(true);
  });

  it("hides live chat when closed without showing a big placeholder button", () => {
    act(() => {
      root.render(
        createElement(WatchSidePanels, {
          videoId: "test-vid",
          chat: { isReplay: true },
          chapters: [],
          autoChapters: false,
        }),
      );
    });

    const closeBtn = container.querySelector("[data-testid='close-chat-btn']") as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    act(() => {
      closeBtn.click();
    });

    expect(usePlayerStore.getState().isLiveChatOpen).toBe(false);
    expect(container.querySelector("[data-testid='live-chat']")).toBeNull();
    expect(container.querySelector("button")).toBeNull();

    act(() => {
      usePlayerStore.getState().setIsLiveChatOpen(true);
    });

    expect(usePlayerStore.getState().isLiveChatOpen).toBe(true);
    expect(container.querySelector("[data-testid='live-chat']")).not.toBeNull();
  });

  it("does not render chat when chat is null", () => {
    act(() => {
      root.render(
        createElement(WatchSidePanels, {
          videoId: "test-vid",
          chat: null,
          chapters: [],
          autoChapters: false,
        }),
      );
    });

    expect(container.querySelector("[data-testid='live-chat']")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(usePlayerStore.getState().isLiveChatAvailable).toBe(false);
  });
});
