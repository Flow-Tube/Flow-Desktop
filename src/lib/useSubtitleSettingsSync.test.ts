import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const persistSetting = vi.fn().mockResolvedValue(undefined);

let root: Root | null = null;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("./api/db", () => ({ getSetting: vi.fn(), setSetting: persistSetting }));
  persistSetting.mockClear();
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.doUnmock("./api/db");
});

async function mountSync() {
  const { useSubtitleSettingsSync } = await import("./useSubtitleSettingsSync");
  const { useAppSettingsStore } = await import("../store/useAppSettingsStore");
  const { usePlayerStore } = await import("../store/usePlayerStore");
  useAppSettingsStore.getState().hydrateSettings({ subtitle_font_scale: "100", subtitle_bold: "true" });
  function Probe() {
    useSubtitleSettingsSync();
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(createElement(Probe)));
  return { useAppSettingsStore, usePlayerStore };
}

describe("useSubtitleSettingsSync", () => {
  it("saves a size and weight changed in the player to the settings", async () => {
    const { useAppSettingsStore, usePlayerStore } = await mountSync();
    const { subtitleStyle, setSubtitleStyle } = usePlayerStore.getState();

    act(() => setSubtitleStyle({ ...subtitleStyle, fontScale: 200, isBold: false }));

    expect(useAppSettingsStore.getState().values.subtitle_font_scale).toBe("200");
    expect(useAppSettingsStore.getState().values.subtitle_bold).toBe("false");
    expect(persistSetting).toHaveBeenCalledWith("subtitle_font_scale", "200");
  });

  it("writes nothing on launch or when only the position changes", async () => {
    const { usePlayerStore } = await mountSync();
    const { subtitleStyle, setSubtitleStyle } = usePlayerStore.getState();

    act(() => setSubtitleStyle({ ...subtitleStyle, bottomOffset: 10 }));

    expect(persistSetting).not.toHaveBeenCalled();
  });
});

