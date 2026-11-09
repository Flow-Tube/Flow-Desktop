// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { GroupItem, PlayerButtonGroup } from "./PlayerButtonGroup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("player button group", () => {
  it("presses a slot from its own button, not from a menu it opened", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(PlayerButtonGroup, {
          children: createElement(GroupItem, {
            id: "more",
            children: [
              createElement("button", { key: "t", id: "trigger" }),
              createElement("div", { key: "m", role: "menu" }, createElement("button", { id: "row" })),
            ],
          }),
        }),
      ),
    );
    const slot = host.querySelector("[role=group] > div")!;
    const press = (id: string, type: string) =>
      act(() => void host.querySelector(`#${id}`)!.dispatchEvent(new PointerEvent(type, { bubbles: true })));

    await press("row", "pointerdown");
    expect(slot.hasAttribute("data-pressed")).toBe(false);
    await press("row", "pointerup");

    await press("trigger", "pointerdown");
    expect(slot.hasAttribute("data-pressed")).toBe(true);
    await press("trigger", "pointerup");
    expect(slot.hasAttribute("data-pressed")).toBe(false);
    await act(async () => root.unmount());
  });
});
