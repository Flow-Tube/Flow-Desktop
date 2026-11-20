import { describe, expect, it } from "vitest";

import { keyBelongsToTarget } from "./target";

describe("keyBelongsToTarget", () => {
  it("lets fields and sliders keep their own keys", () => {
    const input = document.createElement("input");
    expect(keyBelongsToTarget(input, "k")).toBe(true);
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    expect(keyBelongsToTarget(slider, "ArrowLeft")).toBe(true);
    expect(keyBelongsToTarget(slider, "k")).toBe(false);
  });

  it("gives Space and Enter to a button only while it shows keyboard focus", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(keyBelongsToTarget(button, " ")).toBe(false);
    button.focus();
    expect(keyBelongsToTarget(button, " ")).toBe(true);
    expect(keyBelongsToTarget(button, "Enter")).toBe(true);
    expect(keyBelongsToTarget(button, "k")).toBe(false);
    button.remove();
  });
});
