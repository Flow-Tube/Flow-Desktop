import { describe, expect, it } from "vitest";

import { contrastRatio, parseHex, tone } from "./color/tone";
import { playerColors, playerCssVariables, playerTurnsLight, toggleColorsOn } from "./playerColors";
import { BUILTIN_THEMES } from "./themes";

const app = BUILTIN_THEMES[0]!.variants.dark;
const lightApp = BUILTIN_THEMES[0]!.variants.light;
const pale = { base: { r: 236, g: 232, b: 220 }, accent: { r: 250, g: 240, b: 160 } };
const dim = { base: { r: 20, g: 22, b: 40 }, accent: { r: 30, g: 30, b: 90 } };

describe("playerColors", () => {
  it("keeps a pale cover's player dark and its controls readable", () => {
    const { roles, backdrop } = playerColors({ swatches: pale, style: "gradient", app, light: false, artworkControls: true, plainControls: "monochrome" });
    expect(tone(roles.surface)).toBeLessThanOrEqual(30);
    expect(contrastRatio(roles.primary, roles.surface)).toBeGreaterThanOrEqual(4.5);
    expect(backdrop.ground).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("lifts a dark accent off a dark cover", () => {
    const { roles } = playerColors({ swatches: dim, style: "blur_gradient", app, light: false, artworkControls: true, plainControls: "monochrome" });
    expect(contrastRatio(roles.primary, roles.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("mirrors onto light tones for the light player", () => {
    const { roles, backdrop } = playerColors({ swatches: dim, style: "blur", app: lightApp, light: true, artworkControls: true, plainControls: "monochrome" });
    expect(tone(roles.surface)).toBeGreaterThan(90);
    expect(contrastRatio(roles.primary, roles.surface)).toBeGreaterThanOrEqual(4.5);
    expect(tone(backdrop.ground)).toBeGreaterThan(90);
  });

  it("paints monochrome controls white on a dark player", () => {
    const { roles } = playerColors({ swatches: pale, style: "gradient", app, light: false, artworkControls: false, plainControls: "monochrome" });
    expect(roles.primary).toEqual({ r: 255, g: 255, b: 255 });
    expect(roles.primaryContainer).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("follows the app theme for the Default style", () => {
    const { roles } = playerColors({ swatches: pale, style: "default", app: lightApp, light: false, artworkControls: true, plainControls: "monochrome" });
    expect(roles.surface).toEqual(parseHex(lightApp.background));
  });

  it("only turns light when asked, for a light app, on an artwork style", () => {
    const white = { r: 250, g: 250, b: 250 };
    expect(playerTurnsLight("blur", true, white)).toBe(true);
    expect(playerTurnsLight("blur", false, white)).toBe(false);
    expect(playerTurnsLight("default", true, white)).toBe(false);
    expect(playerTurnsLight("blur", true, { r: 10, g: 10, b: 10 })).toBe(false);
  });

  it("points the theme primary at the control colour", () => {
    const colors = playerColors({ swatches: dim, style: "gradient", app, light: false, artworkControls: true, plainControls: "monochrome" });
    const variables = playerCssVariables(colors);
    expect(variables["--color-primary"]).toBe(variables["--player-primary"]);
  });

  it("makes a dock toggle readable on a light dock", () => {
    const surface = { r: 232, g: 232, b: 232 };
    const { color } = toggleColorsOn(surface, pale, lightApp, true, "monochrome");
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    expect(contrastRatio({ r: r!, g: g!, b: b! }, surface)).toBeGreaterThanOrEqual(4.5);
  });
});
