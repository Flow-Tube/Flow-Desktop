import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withDecodeFailure, type DecodeFailures } from "../../../lib/codecHealth";
import { useCodecHealthStore } from "../../../store/useCodecHealthStore";
import { QualityTab } from "./QualityTab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { resolvedLanguage: "en" } }) }));

const preferences = vi.hoisted(() => ({ codec: "H.264" }));
vi.mock("../../../lib/usePreference", () => ({
  usePreference: (key: string, fallback: string) =>
    [key === "default_video_codec" ? preferences.codec : fallback, vi.fn()],
  useBoolPref: () => [false, vi.fn()],
}));

const failingAv1 = (): DecodeFailures =>
  ["a", "b", "c"].reduce<DecodeFailures>((all, id) => withDecodeFailure(all, "av1", id, true), {});

describe("QualityTab codec choices", () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = () => act(() => root.render(createElement(QualityTab)));
  const buttonNamed = (text: string) =>
    [...document.body.querySelectorAll("button")].find((button) => button.textContent?.includes(text));
  const codecMenu = () => {
    act(() => buttonNamed(preferences.codec)?.click());
    return [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  };
  const option = (options: HTMLButtonElement[], text: string) =>
    options.find((item) => item.textContent?.includes(text))!;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    preferences.codec = "H.264";
    useCodecHealthStore.setState({ failures: {} });
    vi.stubGlobal("MediaSource", { isTypeSupported: () => true });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("offers every codec on a device that supports them", () => {
    render();
    const options = codecMenu();
    expect(option(options, "AV1").disabled).toBe(false);
    expect(option(options, "VP9").disabled).toBe(false);
    expect(buttonNamed("Try again")).toBeUndefined();
  });

  it("greys out a codec the device doesn't support, with no retry to offer", () => {
    vi.stubGlobal("MediaSource", { isTypeSupported: (type: string) => !type.includes("av01") });
    render();
    const av1 = option(codecMenu(), "AV1");
    expect(av1.disabled).toBe(true);
    expect(av1.textContent).toContain("not supported on this device");
    expect(buttonNamed("Try again")).toBeUndefined();
  });

  it("greys out a codec that keeps failing, and Try again brings it back", () => {
    useCodecHealthStore.setState({ failures: failingAv1() });
    render();
    expect(option(codecMenu(), "AV1").disabled).toBe(true);

    act(() => buttonNamed("Try again")!.click());

    expect(buttonNamed("Try again")).toBeUndefined();
    expect(useCodecHealthStore.getState().failures.av1).toEqual([]);
  });

  it("doesn't grey out a codec over one failed video", () => {
    useCodecHealthStore.setState({ failures: withDecodeFailure({}, "av1", "a", true) });
    render();
    expect(option(codecMenu(), "AV1").disabled).toBe(false);
  });

  it("explains when the saved preference can't play here", () => {
    preferences.codec = "AV1";
    vi.stubGlobal("MediaSource", { isTypeSupported: (type: string) => !type.includes("av01") });
    render();
    expect(document.body.textContent).toContain("AV1 can't play on this device, so Flow uses another codec.");
  });
});
