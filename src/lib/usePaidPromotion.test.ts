// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPaidPromotion = vi.fn();
vi.mock("./api/youtube", () => ({ getPaidPromotion: (...args: unknown[]) => getPaidPromotion(...args) }));
const { usePaidPromotion } = await import("./usePaidPromotion");
const { useAppSettingsStore } = await import("../store/useAppSettingsStore");
const { usePlayerStore } = await import("../store/usePlayerStore");
const { SETTINGS } = await import("./settings/schema");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let label: ReturnType<typeof usePaidPromotion>;
let root: Root;
function Probe() {
  label = usePaidPromotion("v");
  return null;
}
const setEnabled = (on: boolean) =>
  useAppSettingsStore.setState((s) => ({ values: { ...s.values, [SETTINGS.PAID_PROMOTION_LABEL]: String(on) } }));

beforeEach(() => {
  vi.useFakeTimers();
  getPaidPromotion.mockReset();
  usePlayerStore.setState({ playbackStartedVideoId: "v" });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("usePaidPromotion", () => {
  it("asks for nothing with the setting off, the default", async () => {
    setEnabled(false);
    await act(async () => root.render(createElement(Probe)));
    expect(getPaidPromotion).not.toHaveBeenCalled();
  });

  it("waits for playback, then shows the label for as long as YouTube says", async () => {
    setEnabled(true);
    usePlayerStore.setState({ playbackStartedVideoId: null });
    getPaidPromotion.mockResolvedValue({ text: "Includes paid promotion", durationMs: 5000 });
    await act(async () => root.render(createElement(Probe)));
    expect(getPaidPromotion).not.toHaveBeenCalled();
    await act(async () => usePlayerStore.setState({ playbackStartedVideoId: "v" }));
    expect(label?.text).toBe("Includes paid promotion");
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(label).toBeNull();
  });

  it("shows nothing when the request fails or the video has no label", async () => {
    setEnabled(true);
    getPaidPromotion.mockRejectedValue(new Error("down"));
    await act(async () => root.render(createElement(Probe)));
    expect(label).toBeNull();
  });
});
