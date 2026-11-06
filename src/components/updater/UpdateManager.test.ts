import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUpdaterStore } from "../../store/useUpdaterStore";
import { LONG_SESSION_CHECK_MS, UpdateManager } from "./UpdateManager";

vi.mock("./UpdateDialog", () => ({ UpdateDialog: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STARTUP_MS = 4_000;

describe("UpdateManager", () => {
  let root: Root;
  const checkForUpdates = vi.fn(async () => "uptodate" as const);

  const mount = () =>
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(createElement(UpdateManager, { enabled: true }));
    });
  const pass = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  beforeEach(() => {
    vi.useFakeTimers();
    checkForUpdates.mockClear();
    useUpdaterStore.setState({
      phase: "idle",
      autoCheck: true,
      prefsLoaded: true,
      checkForUpdates,
      loadPreferences: async () => {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("checks at launch and again every 12 hours", async () => {
    mount();
    await pass(STARTUP_MS);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    await pass(LONG_SESSION_CHECK_MS);
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(checkForUpdates).toHaveBeenLastCalledWith({ silent: true });
  });

  it("leaves an update in progress alone", async () => {
    mount();
    await pass(STARTUP_MS);
    useUpdaterStore.setState({ phase: "installed" });
    await pass(LONG_SESSION_CHECK_MS);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when automatic checks are off", async () => {
    useUpdaterStore.setState({ autoCheck: false });
    mount();
    await pass(STARTUP_MS + LONG_SESSION_CHECK_MS);
    expect(checkForUpdates).not.toHaveBeenCalled();
  });
});
