import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackOnline } from "./useBackOnline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

function Probe({ onBack, enabled }: { onBack: () => void; enabled: boolean }) {
  useBackOnline(onBack, enabled);
  return null;
}

const render = (onBack: () => void, enabled: boolean) =>
  act(() => root.render(createElement(Probe, { onBack, enabled })));
const reconnect = () => act(() => void window.dispatchEvent(new Event("online")));

describe("useBackOnline", () => {
  beforeEach(() => {
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("retries once per reconnect and never on mount", () => {
    const onBack = vi.fn();
    render(onBack, true);
    expect(onBack).not.toHaveBeenCalled();
    reconnect();
    expect(onBack).toHaveBeenCalledTimes(1);
    reconnect();
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("does nothing while the screen has not failed", () => {
    const onBack = vi.fn();
    render(onBack, false);
    reconnect();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("calls the newest callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(first, true);
    render(second, true);
    reconnect();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops listening once unmounted", () => {
    const onBack = vi.fn();
    render(onBack, true);
    act(() => root.unmount());
    root = createRoot(document.createElement("div"));
    reconnect();
    expect(onBack).not.toHaveBeenCalled();
  });
});
