import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NavigationType } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEntry } from "../../lib/tabs/tabHistory";
import { useTabsStore } from "../../store/useTabsStore";
import { SwipeNavigationHost } from "./SwipeNavigationHost";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const swipe = (deltaX: number, steps: number, target: EventTarget = document.body) => {
  for (let step = 0; step < steps; step += 1) {
    act(() => {
      target.dispatchEvent(new WheelEvent("wheel", { deltaX, bubbles: true }));
    });
  }
};

describe("SwipeNavigationHost", () => {
  let root: Root;
  let go: ReturnType<typeof vi.fn<(delta: number) => void>>;
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [{ id: "t", entries: [createEntry("/"), createEntry("/feed")], index: 1 }],
      activeId: "t",
      action: NavigationType.Pop,
      cause: "history",
    });
    go = vi.fn<(delta: number) => void>();
    useTabsStore.setState({ go });
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(SwipeNavigationHost)));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("goes back once after a long enough swipe to the right, ignoring its momentum", () => {
    swipe(-20, 12);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
  });

  it("does nothing for a short swipe or where there is no page to go to", () => {
    swipe(-20, 3);
    expect(go).not.toHaveBeenCalled();
    swipe(20, 12);
    expect(go).not.toHaveBeenCalled();
  });

  it("leaves swipes over the player alone", () => {
    const player = document.createElement("div");
    player.id = "flow-player-root";
    document.body.append(player);
    swipe(-20, 12, player);
    expect(go).not.toHaveBeenCalled();
  });
});
