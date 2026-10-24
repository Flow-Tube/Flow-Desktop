import { describe, expect, it } from "vitest";

import { GraphicEq } from "./limits";
import { migrateLegacyEq } from "./legacyMigration";
import { decodeEqState, encodeEqState } from "./stateJson";
import { defaultEqState, statesEqual } from "./stateOps";

// What Android's EqStateJson.encode writes (kotlinx, encodeDefaults), trimmed to one band.
const ANDROID_JSON = `{"version":1,"enabled":true,"mode":"PARAMETRIC",
"parametric":{"presetId":"builtin:rock","curve":{"preamp":0.0,"bands":[{"frequency":60.0,"gain":5.0,"q":0.707,"type":"LOW_SHELF","enabled":true}]}},
"graphic":{"presetId":null,"curve":{"preamp":0.0,"bands":[]}},
"autoPreamp":true,"bassBoost":2.5,
"userPresets":[{"id":"user:1","name":"Car","curve":{"preamp":-1.0,"bands":[]},"mode":"GRAPHIC","imported":false}]}`;

describe("EqStateJson", () => {
  it("reads Android's JSON, repairing what the schema allows", () => {
    const state = decodeEqState(ANDROID_JSON)!;
    expect(state.parametric.presetId).toBe("builtin:rock");
    expect(state.parametric.curve.bands[0]).toEqual({
      frequency: 60,
      gain: 5,
      q: 0.707,
      type: "LOW_SHELF",
      enabled: true,
    });
    expect(state.bassBoost).toBe(2.5);
    expect(state.userPresets[0]!.mode).toBe("GRAPHIC");
    // A graphic curve that is not ten bands becomes flat, as Android's sanitizer does.
    expect(state.graphic.curve).toEqual(GraphicEq.flatCurve());
  });

  it("writes every field Android reads, under the same names", () => {
    const parsed = JSON.parse(encodeEqState(defaultEqState()));
    expect(Object.keys(parsed)).toEqual([
      "version",
      "enabled",
      "mode",
      "parametric",
      "graphic",
      "autoPreamp",
      "bassBoost",
      "userPresets",
    ]);
    expect(parsed.parametric).toEqual({ presetId: "builtin:flat", curve: { preamp: 0, bands: [] } });
    expect(parsed.graphic.presetId).toBeNull();
    expect(parsed.graphic.curve.bands[0]).toEqual({ frequency: 31, gain: 0, q: 1.41, type: "PEAK", enabled: true });
  });

  it("an empty object is the default state, and a wrong type rejects the whole value", () => {
    expect(statesEqual(decodeEqState("{}")!, defaultEqState())).toBe(true);
    expect(decodeEqState(`{"enabled":"yes"}`)).toBeNull();
    expect(decodeEqState(`{"mode":"SPECTRAL"}`)).toBeNull();
    expect(decodeEqState("[]")).toBeNull();
  });
});

describe("migrateLegacyEq", () => {
  it("carries the old ten gains over as a graphic curve", () => {
    const state = migrateLegacyEq({ eqEnabled: true, eqGains: [6, 5, 4, 2, 0, 0, 0, 0, 1, 2.3] })!;
    expect(state.enabled).toBe(true);
    expect(state.mode).toBe("GRAPHIC");
    expect(state.graphic.presetId).toBeNull();
    expect(GraphicEq.gainsOf(state.graphic.curve)).toEqual([6, 5, 4, 2, 0, 0, 0, 0, 1, 2.5]);
    expect(state.graphic.curve.bands.every((b) => b.type === "PEAK")).toBe(true);
  });

  it("migrates nothing when the old equalizer was never used", () => {
    expect(migrateLegacyEq(null)).toBeNull();
    expect(migrateLegacyEq({ eqEnabled: false, eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] })).toBeNull();
    expect(migrateLegacyEq({ volume: 0.4 } as never)).toBeNull();
  });

  it("keeps a curve that was switched off, off", () => {
    const state = migrateLegacyEq({ eqEnabled: false, eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3] })!;
    expect(state.enabled).toBe(false);
    expect(GraphicEq.gainsOf(state.graphic.curve)[9]).toBe(3);
  });
});
