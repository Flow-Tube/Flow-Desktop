// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const handlers: Array<(event: { payload: unknown }) => void> = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.push(handler);
    return () => {};
  }),
  emit: vi.fn(async () => {}),
}));
vi.mock("./appWindow", () => ({ CURRENT_WINDOW_LABEL: "pip", IS_MAIN_WINDOW: false }));
const refresh = vi.fn(async () => {});
vi.mock("./storeRefresh", () => ({ refreshForSettingKeys: refresh }));

const { useOtherWindowSettings } = await import("./useOtherWindowSettings");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useOtherWindowSettings();
  return null;
}

describe("useOtherWindowSettings", () => {
  it("reloads settings another window wrote, and nothing else", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    const handler = handlers[handlers.length - 1]!;

    handler({ payload: { source: "main", keys: ["autoplay_enabled", "liked_items"] } });
    expect(refresh).toHaveBeenCalledWith(["autoplay_enabled"]);

    refresh.mockClear();
    handler({ payload: { source: "main", keys: ["liked_items"] } });
    handler({ payload: { source: "pip", keys: ["autoplay_enabled"] } });
    expect(refresh).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
