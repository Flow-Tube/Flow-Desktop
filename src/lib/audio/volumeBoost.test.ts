// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MAX_VOLUME_BOOST, splitVolumeLevel, useVolumeLevel, volumeLevel } from "./volumeBoost";
import { SETTINGS } from "../settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";

const webAudio = vi.hoisted(() => ({ works: true }));
vi.mock("./mediaEqEngine", () => ({ videoEqAvailable: () => webAudio.works, MediaEqEngine: class {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("volume boost", () => {
  it("keeps the element at or below full volume and puts the rest in gain", () => {
    expect(splitVolumeLevel(0.4, MAX_VOLUME_BOOST)).toEqual({ volume: 0.4, boost: 1 });
    expect(splitVolumeLevel(1, MAX_VOLUME_BOOST)).toEqual({ volume: 1, boost: 1 });
    expect(splitVolumeLevel(1.5, MAX_VOLUME_BOOST)).toEqual({ volume: 1, boost: 1.5 });
    expect(splitVolumeLevel(9, MAX_VOLUME_BOOST)).toEqual({ volume: 1, boost: 2 });
    expect(splitVolumeLevel(-1, MAX_VOLUME_BOOST)).toEqual({ volume: 0, boost: 1 });
  });

  it("stops at 100% with the setting off", () => {
    expect(splitVolumeLevel(1.5, 1)).toEqual({ volume: 1, boost: 1 });
    expect(volumeLevel(1, 1.8, false)).toBe(1);
  });

  it("reads back a boosted level only at full volume", () => {
    expect(volumeLevel(1, 1.8, true)).toBe(1.8);
    expect(volumeLevel(0.5, 1.8, true)).toBe(0.5);
  });
});

describe("useVolumeLevel", () => {
  async function levelWith(works: boolean) {
    webAudio.works = works;
    useAppSettingsStore.setState((s) => ({ values: { ...s.values, [SETTINGS.ALLOW_VOLUME_BOOST]: "true" } }));
    usePlayerStore.setState({ volume: 1, volumeBoost: 1.5 });
    let hook!: ReturnType<typeof useVolumeLevel>;
    function Probe() {
      hook = useVolumeLevel();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    await act(async () => root.unmount());
    return hook;
  }

  it("goes past 100% where WebAudio works", async () => {
    const hook = await levelWith(true);
    expect(hook).toMatchObject({ level: 1.5, maxLevel: MAX_VOLUME_BOOST, gain: 1.5 });
  });

  it("stops at 100% where WebAudio failed, whatever was saved", async () => {
    const hook = await levelWith(false);
    expect(hook).toMatchObject({ level: 1, maxLevel: 1, gain: 1 });
  });
});
