import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Topbar } from "./Topbar";
import { usePlayerStore } from "../../store/usePlayerStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function barAt(path: string, flags: { spread: boolean; below: boolean }) {
  usePlayerStore.setState({ isAmbientSpreadShown: flags.spread, isPlayerBelowTopbar: flags.below });
  act(() => {
    root.render(createElement(MemoryRouter, { key: path, initialEntries: [path] }, createElement(Topbar)));
  });
  const header = host.querySelector("header");
  if (!header) throw new Error("no top bar");
  return header.className;
}

describe("Topbar", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    usePlayerStore.setState({ isAmbientSpreadShown: false, isPlayerBelowTopbar: false });
  });

  it("lets the glow through while the player sits below it", () => {
    expect(barAt("/watch/abc", { spread: true, below: true })).toContain("bg-transparent");
  });

  it("turns solid at once when the video reaches it", () => {
    const className = barAt("/watch/abc", { spread: true, below: false });
    expect(className).toContain("bg-background");
    expect(className).not.toContain("transition-colors");
  });

  it("stays solid without the spread glow or off the watch page", () => {
    expect(barAt("/watch/abc", { spread: false, below: true })).toContain("bg-background");
    expect(barAt("/feed", { spread: true, below: true })).toContain("bg-background");
  });
});
