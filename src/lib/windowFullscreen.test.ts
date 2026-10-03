import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWindowFullscreenController,
  watchNativeFullscreen,
} from "./windowFullscreen";

const nativeWindowMock = vi.hoisted(() => ({
  fullscreen: true,
  listeners: [] as Array<() => void>,
  queries: [] as Array<Promise<boolean>>,
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
    isFullscreen: () => nativeWindowMock.queries.shift() ?? Promise.resolve(nativeWindowMock.fullscreen),
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
  nativeWindowMock.queries.length = 0;
});

describe("createWindowFullscreenController", () => {
  it("reports a failed native transition and allows the next request to recover", async () => {
    const setNativeFullscreen = vi.fn()
      .mockRejectedValueOnce(new Error("Window transition refused"))
      .mockResolvedValue(undefined);
    const controller = createWindowFullscreenController(setNativeFullscreen);

    expect(await controller.sync(true)).toBe(false);
    expect(controller.isTransitioning()).toBe(false);
    expect(await controller.sync(true)).toBe(true);
    expect(setNativeFullscreen).toHaveBeenCalledTimes(2);
  });

  it("does not confirm an obsolete request while a newer exit is pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const setNativeFullscreen = vi.fn().mockImplementationOnce(() => gate)
      .mockResolvedValue(undefined);
    const controller = createWindowFullscreenController(setNativeFullscreen);

    const enter = controller.sync(true);
    await Promise.resolve();
    const exit = controller.sync(false);
    release();
    expect(await enter).toBe(false);
    expect(await exit).toBe(true);
    expect(setNativeFullscreen.mock.calls).toEqual([[true], [false]]);
  });

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

describe("watchNativeFullscreen", () => {
  it("ignores a stale exit query that resolves after a newer native entry", async () => {
    const setNativeFullscreen = vi.fn(async () => {});
    const controller = createWindowFullscreenController(setNativeFullscreen);
    const dispose = await watchNativeFullscreen(controller, () => false, vi.fn());

    let release!: (value: boolean) => void;
    nativeWindowMock.queries.push(new Promise((resolve) => { release = resolve; }));
    nativeWindowMock.listeners[0]!();
    await emitNativeResize();
    release(false);
    await Promise.resolve();

    await controller.sync(false);
    expect(setNativeFullscreen).toHaveBeenCalledWith(false);
    dispose();
  });

  it("stops observing even when the initial native query is still pending", async () => {
    let release!: (value: boolean) => void;
    nativeWindowMock.queries.push(new Promise((resolve) => { release = resolve; }));
    const onExternalExit = vi.fn();
    const dispose = await watchNativeFullscreen(
      createWindowFullscreenController(async () => {}), () => true, onExternalExit,
    );

    dispose();
    release(false);
    await Promise.resolve();
    expect(nativeWindowMock.listeners).toHaveLength(0);
    expect(onExternalExit).not.toHaveBeenCalled();
  });

  it("adopts existing native fullscreen without enabling video presentation", async () => {
    const setNativeFullscreen = vi.fn(async () => {});
    const controller = createWindowFullscreenController(setNativeFullscreen);
    const onExternalExit = vi.fn();
    const dispose = await watchNativeFullscreen(controller, () => false, onExternalExit);

    expect(onExternalExit).not.toHaveBeenCalled();
    expect(await controller.sync(false)).toBe(true);
    expect(setNativeFullscreen).toHaveBeenCalledWith(false);
    dispose();
  });

  it("tracks green-button entry while the player is not fullscreen", async () => {
    nativeWindowMock.fullscreen = false;
    const setNativeFullscreen = vi.fn(async () => {});
    const controller = createWindowFullscreenController(setNativeFullscreen);
    const onExternalExit = vi.fn();
    const dispose = await watchNativeFullscreen(controller, () => false, onExternalExit);

    nativeWindowMock.fullscreen = true;
    await emitNativeResize();
    expect(onExternalExit).not.toHaveBeenCalled();
    expect(await controller.sync(false)).toBe(true);
    expect(setNativeFullscreen).toHaveBeenCalledWith(false);
    dispose();
  });

  it("reconciles a native exit even when the player has already left fullscreen", async () => {
    const setNativeFullscreen = vi.fn(async () => {});
    const controller = createWindowFullscreenController(setNativeFullscreen);
    const dispose = await watchNativeFullscreen(controller, () => false, vi.fn());

    nativeWindowMock.fullscreen = false;
    await emitNativeResize();
    expect(await controller.sync(true)).toBe(true);
    expect(setNativeFullscreen).toHaveBeenCalledWith(true);
    dispose();
  });

  it("removes its listener when disposed", async () => {
    const dispose = await watchNativeFullscreen(
      createWindowFullscreenController(async () => {}), () => false, vi.fn(),
    );
    expect(nativeWindowMock.listeners).toHaveLength(1);
    dispose();
    expect(nativeWindowMock.listeners).toHaveLength(0);
  });

  it("reports an OS-initiated exit once and reconciles the controller", async () => {
    const setNativeFullscreen = vi.fn(async () => {});
    const controller = createWindowFullscreenController(setNativeFullscreen);
    await controller.sync(true);

    let storeFullscreen = true;
    const onExternalExit = vi.fn(() => {
      storeFullscreen = false;
    });
    await watchNativeFullscreen(controller, () => storeFullscreen, onExternalExit);

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
    const dispose = await watchNativeFullscreen(controller, () => true, onExternalExit);

    await emitNativeResize();
    expect(onExternalExit).not.toHaveBeenCalled();
    dispose();
  });

  it("does not fire when the app does not expect to be fullscreen", async () => {
    const controller = createWindowFullscreenController(async () => {});
    await controller.sync(true);

    const onExternalExit = vi.fn();
    const dispose = await watchNativeFullscreen(controller, () => false, onExternalExit);

    nativeWindowMock.fullscreen = false;
    await emitNativeResize();
    expect(onExternalExit).not.toHaveBeenCalled();
    dispose();
  });
});
