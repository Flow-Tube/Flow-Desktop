import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaMenu, type MediaMenuAction } from "./MediaMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const action = (id: string, group: MediaMenuAction["group"], extra: Partial<MediaMenuAction> = {}): MediaMenuAction => ({
  id,
  label: `${id} label`,
  icon: null,
  group,
  onSelect: vi.fn(),
  ...extra,
});

let host: HTMLDivElement;
let root: Root;

function render(actions: MediaMenuAction[], onClose = vi.fn()) {
  act(() => {
    root.render(createElement(MediaMenu, {
      anchor: { top: 10, left: 10 },
      onClose,
      actions,
      header: { title: "Me at the zoo", subtitle: "jawed" },
    }));
  });
  return onClose;
}

const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];

describe("MediaMenu", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("puts quick actions first as tiles, then the groups in a fixed order", () => {
    render([
      action("feed-1", "feed"),
      action("go-1", "go"),
      action("tile-1", "quick", { tileLabel: "Tile" }),
      action("lib-1", "library"),
      action("plain", undefined),
    ]);
    expect(items().map((item) => item.textContent)).toEqual([
      "Tile",
      "lib-1 label",
      "plain label",
      "go-1 label",
      "feed-1 label",
    ]);
    expect(document.querySelectorAll('[role="separator"]').length).toBe(3);
  });

  it("keeps at most four tiles", () => {
    render(["a", "b", "c", "d", "e"].map((id) => action(id, "quick")));
    expect(items()).toHaveLength(4);
  });

  it("closes, then runs the action", () => {
    const run = action("go-1", "go");
    const onClose = render([run]);
    act(() => items()[0]!.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(run.onSelect).toHaveBeenCalledOnce();
  });

  it("moves focus with the arrow keys and wraps around", () => {
    render([action("a", "library"), action("b", "library"), action("c", "go")]);
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(document.activeElement).toBe(menu);
    const press = (key: string) => act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    press("ArrowDown");
    expect(document.activeElement?.textContent).toBe("a label");
    press("ArrowUp");
    expect(document.activeElement?.textContent).toBe("c label");
    press("Home");
    expect(document.activeElement?.textContent).toBe("a label");
  });
});
