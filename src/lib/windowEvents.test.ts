import { afterEach, describe, expect, it, vi } from "vitest";

const emit = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/event", () => ({ emit }));
vi.mock("./appWindow", () => ({ CURRENT_WINDOW_LABEL: "flow-2" }));

const { DATA_CHANGED_EVENT, announceSettingWrite } = await import("./windowEvents");
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

afterEach(() => emit.mockClear());

describe("announceSettingWrite", () => {
  it("sends the writes of one tick as one event, named by window", async () => {
    announceSettingWrite("liked_items");
    announceSettingWrite("user_playlists");
    announceSettingWrite("liked_items");
    await flush();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(DATA_CHANGED_EVENT, { source: "flow-2", keys: ["liked_items", "user_playlists"] });
  });

  it("keeps a window's own tab session to itself", async () => {
    announceSettingWrite("tab_session");
    await flush();
    expect(emit).not.toHaveBeenCalled();
  });
});
