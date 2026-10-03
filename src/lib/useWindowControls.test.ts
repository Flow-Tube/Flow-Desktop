import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowControls } from "./useWindowControls";

const native = vi.hoisted(() => ({
  macos: false,
  isMaximized: vi.fn(async () => true),
  onResized: vi.fn(),
}));

vi.mock("./platform", () => ({ get IS_MACOS_RUNTIME() { return native.macos; } }));
vi.mock("./diagnostics", () => ({ logToBackend: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: ReturnType<typeof useWindowControls>;
let root: ReturnType<typeof createRoot>;

function Harness() {
  latest = useWindowControls();
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  native.macos = false;
  native.isMaximized.mockResolvedValue(true);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
});

describe("useWindowControls", () => {
  it("disposes subscriptions that resolve after StrictMode cleanup", async () => {
    const subscriptions: Array<(dispose: () => void) => void> = [];
    native.onResized.mockImplementation(() => new Promise<() => void>((resolve) => {
      subscriptions.push(resolve);
    }));
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Harness)));
    });

    const staleDispose = vi.fn();
    const activeDispose = vi.fn();
    await act(async () => {
      subscriptions[0]!(staleDispose);
      subscriptions[1]!(activeDispose);
    });
    expect(staleDispose).toHaveBeenCalledTimes(1);
    expect(activeDispose).not.toHaveBeenCalled();
    expect(latest.isMaximized).toBe(true);

    await act(async () => { root.unmount(); });
    expect(activeDispose).toHaveBeenCalledTimes(1);
  });

  it("updates the restore control after an OS resize", async () => {
    let resized!: () => void;
    native.onResized.mockImplementation(async (handler: () => void) => {
      resized = handler;
      return vi.fn();
    });
    await act(async () => { root.render(createElement(Harness)); });
    expect(latest.isMaximized).toBe(true);

    native.isMaximized.mockResolvedValue(false);
    await act(async () => { resized(); });
    expect(latest.isMaximized).toBe(false);
  });

  it("leaves macOS window controls to the native title bar", async () => {
    native.macos = true;
    await act(async () => { root.render(createElement(Harness)); });
    expect(native.onResized).not.toHaveBeenCalled();
    expect(native.isMaximized).not.toHaveBeenCalled();
  });
});
