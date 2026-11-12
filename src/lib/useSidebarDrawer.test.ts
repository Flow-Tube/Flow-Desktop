import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NARROW_WINDOW_QUERY, useSidebarDrawer } from "./useSidebarDrawer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let narrow = false;
let seen: boolean | null = null;

function Probe() {
  seen = useSidebarDrawer();
  return null;
}

describe("useSidebarDrawer", () => {
  let host: HTMLDivElement;
  let root: Root;
  // MemoryRouter reads its path once, so each path gets a fresh root.
  const render = (path: string) => {
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Probe))));
  };

  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === NARROW_WINDOW_QUERY && narrow,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    host = document.createElement("div");
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("keeps the rail on a wide window outside Watch and Settings", () => {
    narrow = false;
    render("/");
    expect(seen).toBe(false);
    render("/watch/abc");
    expect(seen).toBe(true);
  });

  it("opens the drawer on every page of a narrow window, where the rail is hidden", () => {
    narrow = true;
    for (const path of ["/", "/subscriptions", "/library"]) {
      render(path);
      expect(seen).toBe(true);
    }
  });
});
