import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setSetting } = vi.hoisted(() => ({ setSetting: vi.fn(async (_key: string, _value: string) => {}) }));
vi.mock("../lib/api/db", () => ({ getSetting: vi.fn(async () => null), setSetting }));

import { SETTINGS } from "../lib/settings/schema";
import { GraphicEq } from "../lib/audio/eq/limits";
import { activeCopy, selectPreset, withBassBoost } from "../lib/audio/eq/stateOps";
import { decodeEqState, encodeEqState } from "../lib/audio/eq/stateJson";
import { defaultEqState } from "../lib/audio/eq/stateOps";

// Each test gets fresh modules: the store reads the old config once, when it is first imported.
async function load(legacy?: object) {
  vi.resetModules();
  localStorage.clear();
  if (legacy) localStorage.setItem("flow_music_player", JSON.stringify(legacy));
  const settings = await import("./useAppSettingsStore");
  const eq = await import("./useEqStore");
  eq.bindEqPersistence();
  const settle = (raw: string) =>
    settings.useAppSettingsStore.setState((s) => ({
      loaded: true,
      values: { ...s.values, [SETTINGS.EQ_STATE_JSON]: raw },
    }));
  return { eq: eq.useEqStore, settings: settings.useAppSettingsStore, settle };
}

const saved = () => setSetting.mock.calls.filter(([key]) => key === SETTINGS.EQ_STATE_JSON).map(([, value]) => value);

beforeEach(() => {
  vi.useFakeTimers();
  setSetting.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useEqStore", () => {
  it("moves the old desktop gains into the graphic curve once, and saves them", async () => {
    const { eq, settle } = await load({ volume: 0.7, eqEnabled: true, eqGains: [6, 5, 4, 2, 0, 0, 0, 0, 1, 2] });
    settle("{}");

    const state = eq.getState().state;
    expect(state.mode).toBe("GRAPHIC");
    expect(GraphicEq.gainsOf(state.graphic.curve)).toEqual([6, 5, 4, 2, 0, 0, 0, 0, 1, 2]);
    await vi.advanceTimersByTimeAsync(400);
    expect(saved()).toHaveLength(1);
    expect(decodeEqState(saved()[0]!)!.mode).toBe("GRAPHIC");
  });

  it("saves a burst of edits once, 400 ms after the last", async () => {
    const { eq, settle } = await load();
    settle("{}");
    for (let i = 1; i <= 5; i++) eq.getState().update((s) => withBassBoost(s, i));

    await vi.advanceTimersByTimeAsync(300);
    expect(saved()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(saved()).toHaveLength(1);
    expect(decodeEqState(saved()[0]!)!.bassBoost).toBe(5);
  });

  it("keeps drag previews and compare out of the saved state", async () => {
    const { eq, settle } = await load();
    settle("{}");
    eq.getState().setPreview({ preamp: 0, bands: [{ frequency: 1_000, gain: 6, q: 1, type: "PEAK", enabled: true }] });
    eq.getState().setBypass(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved()).toHaveLength(0);
  });

  it("adopts a synced or restored value without writing it back", async () => {
    const { eq, settle } = await load();
    settle("{}");
    const incoming = encodeEqState(selectPreset(defaultEqState(), "builtin:jazz"));
    settle(incoming);

    expect(activeCopy(eq.getState().state).presetId).toBe("builtin:jazz");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved()).toHaveLength(0);
  });

  it("keeps an edit made before the saved state loaded", async () => {
    const { eq, settle } = await load();
    eq.getState().update((s) => ({ ...s, enabled: false }));
    settle(encodeEqState(selectPreset(defaultEqState(), "builtin:rock")));

    const state = eq.getState().state;
    expect(state.enabled).toBe(false);
    expect(activeCopy(state).presetId).toBe("builtin:rock");
    await vi.advanceTimersByTimeAsync(400);
    expect(decodeEqState(saved()[0]!)!.enabled).toBe(false);
  });
});
