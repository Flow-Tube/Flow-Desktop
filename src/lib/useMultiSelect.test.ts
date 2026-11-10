import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useMultiSelect } from "./useMultiSelect";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: ReturnType<typeof useMultiSelect>;
function Probe({ ids }: { ids: string[] }) {
  latest = useMultiSelect(ids);
  return null;
}

describe("useMultiSelect", () => {
  let root: Root;

  beforeEach(() => {
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  const render = (ids: string[]) => act(() => root.render(createElement(Probe, { ids })));

  it("toggles rows and clears on stop", () => {
    render(["a", "b"]);
    act(() => latest.start());
    act(() => latest.toggle("a"));
    expect([...latest.selectedIds]).toEqual(["a"]);
    act(() => latest.toggle("a"));
    expect(latest.selectedIds.size).toBe(0);
    act(() => latest.toggle("b"));
    act(() => latest.stop());
    expect(latest.selecting).toBe(false);
    expect(latest.selectedIds.size).toBe(0);
  });

  it("selects all, then deselects all", () => {
    render(["a", "b"]);
    act(() => latest.toggleAll(["a", "b"]));
    expect(latest.allSelected).toBe(true);
    act(() => latest.toggleAll(["a", "b"]));
    expect(latest.selectedIds.size).toBe(0);
  });

  it("drops a row that leaves the list, and stops when the list empties", () => {
    render(["a", "b"]);
    act(() => latest.start());
    act(() => latest.toggleAll(["a", "b"]));
    render(["b"]);
    expect([...latest.selectedIds]).toEqual(["b"]);
    expect(latest.selecting).toBe(true);
    render([]);
    expect(latest.selecting).toBe(false);
  });
});
