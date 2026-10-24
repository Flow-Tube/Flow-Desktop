import { describe, expect, it } from "vitest";

import { builtInPreset, BUILT_IN_EQ_PRESETS } from "./builtInPresets";
import { autoPreampDb, frequencyAt, magnitudeDb } from "./filterMath";
import { GraphicEq } from "./limits";
import { band, EQ_PROCESSING_OFF, EqLimits, type EqCurve, type EqPreset, type EqState } from "./models";
import { decodeEqState, encodeEqState } from "./stateJson";
import {
  activeCopy,
  addBand,
  canSaveActive,
  changesSound,
  defaultEqState,
  deletePreset,
  importPreset,
  isEdited,
  isNameAvailable,
  presetCurveFor,
  processingSpec,
  restorePreset,
  revert,
  sanitizeState,
  saveActive,
  saveActiveAs,
  selectPreset,
  statesEqual,
  userPreset,
  withActiveCurve,
  withBand,
  withBassBoost,
  withManualPreamp,
} from "./stateOps";

// Ported from Android's EqStateOpsTest.
const rock = "builtin:rock";
const mine: EqPreset = {
  id: "user:a",
  name: "Mine",
  curve: { preamp: 0, bands: [band(500, 3)] },
  mode: "PARAMETRIC",
  imported: false,
};
const state = (patch: Partial<EqState> = {}): EqState => ({ ...defaultEqState(), ...patch });

describe("EqStateOps", () => {
  it("has Android's 13 built-in presets", () => {
    expect(BUILT_IN_EQ_PRESETS.map((p) => p.id)).toEqual([
      "builtin:flat",
      "builtin:acoustic",
      "builtin:bass_boost",
      "builtin:classical",
      "builtin:electronic",
      "builtin:heavy_metal",
      "builtin:hip_hop",
      "builtin:jazz",
      "builtin:metal",
      "builtin:pop",
      "builtin:rnb",
      "builtin:rock",
      "builtin:vocal",
    ]);
  });

  it("selecting a preset loads its curve and is not an edit", () => {
    const s = selectPreset(state(), rock);
    expect(activeCopy(s).presetId).toBe(rock);
    expect(activeCopy(s).curve).toEqual(builtInPreset(rock)!.curve);
    expect(isEdited(s)).toBe(false);
  });

  it("an edited curve stays reachable and reverts to its preset", () => {
    const edited = withBand(selectPreset(state(), rock), 0, band(60, 1, 0.707, "LOW_SHELF"));
    expect(isEdited(edited)).toBe(true);
    expect(activeCopy(edited).presetId).toBe(rock);
    expect(isEdited(revert(edited))).toBe(false);
  });

  it("a built-in cannot be overwritten, a user preset can", () => {
    const builtIn = addBand(selectPreset(state(), rock), band(8_000, 2));
    expect(canSaveActive(builtIn)).toBe(false);
    expect(saveActive(builtIn)).toBe(builtIn);

    const own = addBand(selectPreset(state({ userPresets: [mine] }), mine.id), band(8_000, 2));
    const saved = saveActive(own);
    expect(userPreset(saved, mine.id)!.curve.bands).toHaveLength(2);
    expect(isEdited(saved)).toBe(false);
  });

  it("save as creates a preset and selects it", () => {
    const s = saveActiveAs(addBand(selectPreset(state(), rock), band(8_000, 2)), "user:b", "Car");
    expect(activeCopy(s).presetId).toBe("user:b");
    expect(userPreset(s, "user:b")!.name).toBe("Car");
    expect(isEdited(s)).toBe(false);
  });

  it("deleting a selected preset keeps the sound and undo restores it in place", () => {
    const other = { ...mine, id: "user:z", name: "Other" };
    const s = selectPreset(state({ userPresets: [other, mine] }), mine.id);
    const [deleted, removed] = deletePreset(s, mine.id);

    expect(activeCopy(deleted).presetId).toBeNull();
    expect(activeCopy(deleted).curve).toEqual(mine.curve);

    const restored = restorePreset(deleted, removed!);
    expect(restored.userPresets.map((p) => p.id)).toEqual(["user:z", mine.id]);
    expect(activeCopy(restored).presetId).toBe(mine.id);
  });

  it("each mode keeps its own curve", () => {
    const parametric = selectPreset(state(), rock);
    const graphic = withActiveCurve({ ...parametric, mode: "GRAPHIC" }, GraphicEq.curveOf(Array(10).fill(3)));
    const back = { ...graphic, mode: "PARAMETRIC" as const };
    expect(activeCopy(back).curve).toEqual(activeCopy(parametric).curve);
    expect(back.graphic.curve.bands.map((b) => b.gain)).toEqual(Array(10).fill(3));
  });

  it("importing adds a preset and plays it", () => {
    const curve: EqCurve = { preamp: -2, bands: [band(910, 9, 0.71)] };
    const s = importPreset(state(), "user:i", "Hefty Metal", curve);
    expect(activeCopy(s).presetId).toBe("user:i");
    expect(userPreset(s, "user:i")!.imported).toBe(true);
    expect(s.mode).toBe("PARAMETRIC");
  });

  it("the processing spec adds bass boost and protects the peak", () => {
    const spec = processingSpec(withBassBoost(selectPreset(state(), rock), 6), false);
    expect(spec.enabled).toBe(true);
    const boost = spec.bands[spec.bands.length - 1]!;
    expect(boost.type).toBe("LOW_SHELF");
    expect(boost.gain).toBe(6);
    expect(spec.preampDb).toBeCloseTo(autoPreampDb(spec.bands), 2);
    expect(spec.preampDb).toBeLessThan(0);
  });

  it("manual preamp is used when auto preamp is off", () => {
    const s = withManualPreamp(selectPreset(state({ autoPreamp: false }), rock), -3);
    expect(processingSpec(s, false).preampDb).toBe(-3);
  });

  it("off and compare both produce an unprocessed spec", () => {
    const s = selectPreset(state(), rock);
    expect(processingSpec({ ...s, enabled: false }, false)).toEqual(EQ_PROCESSING_OFF);
    expect(processingSpec(s, true)).toEqual(EQ_PROCESSING_OFF);
  });

  it("a preview replaces the playing curve without touching the state", () => {
    const preview: EqCurve = { preamp: 0, bands: [band(2_000, 5)] };
    expect(processingSpec(selectPreset(state(), rock), false, preview).bands).toEqual([band(2_000, 5)]);
  });

  it("flat and off settings change nothing", () => {
    expect(changesSound(state())).toBe(false);
    expect(changesSound(selectPreset(state(), rock))).toBe(true);
    expect(changesSound({ ...selectPreset(state(), rock), enabled: false })).toBe(false);
    expect(changesSound(withBassBoost(state(), 3))).toBe(true);
    expect(changesSound(addBand(state(), band(1_000, 0)))).toBe(false);
  });

  it("names are unique regardless of case, including built-in names", () => {
    const s = state({ userPresets: [mine] });
    expect(isNameAvailable(s, "mine", ["Rock"])).toBe(false);
    expect(isNameAvailable(s, "ROCK", ["Rock"])).toBe(false);
    expect(isNameAvailable(s, "Mine", ["Rock"], mine.id)).toBe(true);
    expect(isNameAvailable(s, "  ", ["Rock"])).toBe(false);
  });

  it("band edits respect the band limit and graphic mode", () => {
    let full = state();
    for (let i = 1; i <= EqLimits.MAX_BANDS; i++) full = addBand(full, band(i * 100, 1));
    expect(addBand(full, band(5_000, 1))).toBe(full);
    const graphic = state({ mode: "GRAPHIC" });
    expect(addBand(graphic, band(5_000, 1))).toBe(graphic);
  });

  it("sanitising repairs a damaged state", () => {
    const damaged = state({
      graphic: { presetId: null, curve: { preamp: 0, bands: [band(1, 99)] } },
      bassBoost: Number.NaN,
      userPresets: [mine, mine, { id: "", name: "x", curve: { preamp: 0, bands: [] }, mode: "PARAMETRIC", imported: false }],
    });
    const clean = sanitizeState(damaged);
    expect(clean.graphic.curve).toEqual(GraphicEq.flatCurve());
    expect(clean.bassBoost).toBe(0);
    expect(clean.userPresets).toEqual([mine]);
  });

  it("state survives its JSON form", () => {
    const s = withBassBoost(selectPreset(state({ userPresets: [mine] }), mine.id), 4);
    expect(statesEqual(decodeEqState(encodeEqState(s))!, s)).toBe(true);
    expect(decodeEqState("not json")).toBeNull();
  });

  it("a preset picked in graphic mode is fitted onto the ten bands and stays graphic", () => {
    const s = selectPreset(state({ mode: "GRAPHIC" }), rock);
    const rockBands = builtInPreset(rock)!.curve.bands;

    expect(s.mode).toBe("GRAPHIC");
    expect(activeCopy(s).presetId).toBe(rock);
    expect(isEdited(s)).toBe(false);
    expect(s.parametric).toEqual(defaultEqState().parametric);
    const grid = Array.from({ length: 81 }, (_, i) => frequencyAt(0.05 + (0.9 * i) / 80));
    const error = grid.map((f) => magnitudeDb(s.graphic.curve.bands, f) - magnitudeDb(rockBands, f));
    const rms = Math.sqrt(error.reduce((sum, e) => sum + e * e, 0) / error.length);
    expect(rms).toBeLessThan(1);
    const gains = GraphicEq.gainsOf(s.graphic.curve);
    let zigzags = 0;
    for (let i = 0; i + 2 < gains.length; i++) {
      const [a, b, c] = [gains[i]!, gains[i + 1]!, gains[i + 2]!];
      if ((b - a) * (c - b) < 0 && Math.abs(b - a) > 1.5 && Math.abs(c - b) > 1.5) zigzags++;
    }
    expect(zigzags).toBe(0);
  });

  it("revert in graphic mode returns to the fitted preset", () => {
    const picked = selectPreset(state({ mode: "GRAPHIC" }), rock);
    const moved = withActiveCurve(picked, GraphicEq.curveOf(Array(10).fill(6)));
    expect(isEdited(moved)).toBe(true);
    expect(statesEqual(revert(moved), picked)).toBe(true);
  });

  it("a graphic preset picked in parametric mode loads its bands and stays parametric", () => {
    const car: EqPreset = {
      id: "user:car",
      name: "Car",
      curve: GraphicEq.curveOf(Array.from({ length: 10 }, (_, i) => i)),
      mode: "GRAPHIC",
      imported: false,
    };
    const s = selectPreset(state({ userPresets: [car] }), car.id);
    expect(s.mode).toBe("PARAMETRIC");
    expect(activeCopy(s).curve.bands).toHaveLength(10);
    expect(isEdited(s)).toBe(false);
  });

  it("importing from graphic mode switches to parametric, where the file plays exactly", () => {
    const curve: EqCurve = { preamp: 0, bands: [band(910, 9, 0.71)] };
    const s = importPreset(state({ mode: "GRAPHIC" }), "user:i", "Hefty Metal", curve);
    expect(s.mode).toBe("PARAMETRIC");
    expect(activeCopy(s).curve).toEqual(curve);
  });

  it("fitting flat gives flat and never writes a negative zero", () => {
    const fit = GraphicEq.fit({ preamp: 0, bands: [] });
    expect(fit).toEqual(GraphicEq.flatCurve());
    expect(fit.bands.every((b) => !Object.is(b.gain, -0))).toBe(true);
  });

  it("presets apply in the current mode", () => {
    expect(presetCurveFor(state(), "GRAPHIC", rock)!.bands).toHaveLength(10);
    expect(presetCurveFor(state(), "PARAMETRIC", rock)!.bands).toHaveLength(5);
  });
});
