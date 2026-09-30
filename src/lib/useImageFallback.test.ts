import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useImageFallback } from "./useImageFallback";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let result: ReturnType<typeof useImageFallback>;
function Probe({ candidates }: { candidates: Array<string | null> }) {
  result = useImageFallback(candidates);
  return null;
}

let root: Root | null = null;
const render = (candidates: Array<string | null>) =>
  act(() => {
    root ??= createRoot(document.createElement("div"));
    root.render(createElement(Probe, { candidates }));
  });

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("useImageFallback", () => {
  it("moves to the next candidate on each failure, then gives up", () => {
    render(["a", null, "b"]);
    expect(result.src).toBe("a");
    act(() => result.onError());
    expect(result.src).toBe("b");
    act(() => result.onError());
    expect(result.src).toBeNull();
  });

  it("starts over when the candidates change", () => {
    render(["a"]);
    act(() => result.onError());
    expect(result.src).toBeNull();
    render(["c"]);
    expect(result.src).toBe("c");
  });

  it("counts a URL's failure once when several images share it", () => {
    render(["a", "b"]);
    const { onError } = result;
    act(() => {
      onError();
      onError();
    });
    expect(result.src).toBe("b");
  });

  it("skips duplicate candidates", () => {
    render(["a", "a", "b"]);
    act(() => result.onError());
    expect(result.src).toBe("b");
  });

  it("keeps a failure across a re-render with an equal candidate list", () => {
    render(["a", "b"]);
    act(() => result.onError());
    render(["a", "b"]);
    expect(result.src).toBe("b");
  });
});
