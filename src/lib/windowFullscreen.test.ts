import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWindowFullscreenController,
  watchNativeFullscreenExit,
} from "./windowFullscreen";

const nativeWindowMock = vi.hoisted(() => ({
  fullscreen: true,
  listeners: [] as Array<() => void>,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onResized: async (handler: () => void) => {
      nativeWindowMock.listeners.push(handler);
      return () => {
        const index = nativeWindowMock.listeners.indexOf(handler);
        if (index >= 0) nativeWindowMock.listeners.splice(index, 1);
      };
    },
    isFullscreen: async () => nativeWindowMock.fullscreen,
  }),
}));

const emitNativeResize = async () => {
  for (const listener of [...nativeWindowMock.listeners]) listener();
  // The resize handler resolves isFullscreen() asynchronously.
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  nativeWindowMock.fullscreen = true;
  nativeWindowMock.listeners.length = 0;
});

describe("createWindowFullscreenController", () => {
  it("sends native enter and exit transitions in order", async () => {
    const setNativeFullscreen = vi.fn(async () => {});
    const controller = createWindowFullscreenController(setNativeFullscreen);

    await controller.sync(true);
    await controller.sync(false);

    expect(setNativeFullscreen).toHaveBeenCalledTimes(2);
    expect(setNativeFullscreen).toHaveBeenNthCalledWith(1, true);
    expect(setNativeFullscreen).toHaveBeenNthCalledWith(2, false);
  });

  it("does not dispatch a stale enter after fullscreen has already been exited", async () => {
    const setNativeFullscreen = vi.fn(async () => {});
    const controller = createWindowFullscreenController(setNativeFullscreen);

    const enter = controller.sync(true);
    const exit = controller.sync(false);
    await Promise.all([enter, exit]);

    expect(setNativeFullscreen).not.toHaveBeenCalled();
  });

  it("skips duplicate native commands", async () => {
    const setNativeFullscreen = vi.fn(async () => {});
    const controller = createWindowFullscreenController(setNativeFullscreen);

    await controller.sync(true);
    await controller.sync(true);

    expect(setNativeFullscreen).toHaveBeenCalledTimes(1);
  });

  it("exposes pending state while a transition is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const controller = createWindowFullscreenController(() => gate);

    const transition = controller.sync(true);
    expect(controller.isTransitioning()).toBe(true);

    release();
    await transition;
    expect(controller.isTransitioning()).toBe(false);
  });

  it("ignores native reports that match the applied state", async () => {
    const controller = createWindowFullscreenController(async () => {});

    expect(controller.noteNativeFullscreen(false)).toBe(false);
    await controller.sync(true);
    expect(controller.noteNativeFullscreen(true)).toBe(false);
    expect(controller.noteNativeFullscreen(false)).toBe(true);
  });

  it("ignores native reports observed mid-transition", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const controller = createWindowFullscreenController(() => gate);

    const transition = controller.sync(true);
    expect(controller.noteNativeFullscreen(false)).toBe(false);
    release();
    await transition;
  });
});

describe("watchNativeFullscreenExit", () => {
  it("reports an OS-initiated exit once and reconciles the controller", async () => {
    const setNativeFullscreen = vi.fn(async () => {});
    const controller = createWindowFullscreenController(setNativeFullscreen);
    await controller.sync(true);

    let storeFullscreen = true;
    const onExternalExit = vi.fn(() => {
      storeFullscreen = false;
    });
    await watchNativeFullscreenExit(controller, () => storeFullscreen, onExternalExit);

    nativeWindowMock.fullscreen = false;
    await emitNativeResize();
    await emitNativeResize();
    expect(onExternalExit).toHaveBeenCalledTimes(1);

    // The controller now knows the native window is windowed again, so a
    // fresh enter must reach the native layer instead of being deduped.
    await controller.sync(true);
    expect(setNativeFullscreen).toHaveBeenCalledTimes(2);
    expect(setNativeFullscreen).toHaveBeenLastCalledWith(true);
  });

  it("does not fire while the window is still fullscreen", async () => {
    const controller = createWindowFullscreenController(async () => {});
    await controller.sync(true);

    const onExternalExit = vi.fn();
    const dispose = await watchNativeFullscreenExit(controller, () => true, onExternalExit);

    await emitNativeResize();
    expect(onExternalExit).not.toHaveBeenCalled();
    dispose();
  });

  it("does not fire when the app does not expect to be fullscreen", async () => {
    const controller = createWindowFullscreenController(async () => {});
    await controller.sync(true);

    const onExternalExit = vi.fn();
    const dispose = await watchNativeFullscreenExit(controller, () => false, onExternalExit);

    nativeWindowMock.fullscreen = false;
    await emitNativeResize();
    expect(onExternalExit).not.toHaveBeenCalled();
    dispose();
  });
});
