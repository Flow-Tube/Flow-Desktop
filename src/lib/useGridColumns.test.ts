import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useResolvedGridColumns } from "./useGridColumns";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it("coalesces resize writes into a later frame and cancels them on unmount", async () => {
  let notify!: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { notify = callback; }
    observe() {}
    disconnect = disconnect;
  });
  let frame!: FrameRequestCallback;
  const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frame = callback; return 42; });
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  let tracks = "100px 100px";
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ gridTemplateColumns: tracks }) as CSSStyleDeclaration);
  const style = {};
  let resolved = { columns: 0, trackWidth: 0 };
  function Harness() {
    const ref = useRef<HTMLDivElement>(null);
    resolved = useResolvedGridColumns(ref, style);
    return createElement("div", { ref });
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Harness)));
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.getPropertyValue("--flow-grid-track-w")).toBe("100px");
    expect(resolved).toEqual({ columns: 2, trackWidth: 100 });
    tracks = "120.4px 120.4px";
    const resize = (width: number) => notify([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await act(async () => { resize(300); resize(310); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(grid.style.getPropertyValue("--flow-grid-track-w")).toBe("100px");
    await act(async () => frame(0));
    expect(grid.style.getPropertyValue("--flow-grid-track-w")).toBe("120.4px");
    expect(resolved).toEqual({ columns: 2, trackWidth: 120 });
    resize(320);
    await act(async () => root.unmount());
    expect(cancel).toHaveBeenCalledWith(42);
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
