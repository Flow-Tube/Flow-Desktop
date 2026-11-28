import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recapQueriesCleared = vi.hoisted(() => vi.fn());
vi.mock("../../lib/recap/recapQueue", () => ({ recapQueriesCleared, recapSearch: vi.fn() }));
vi.mock("../../lib/usePreference", async () => {
  const { useState } = await import("react");
  const pref = <T,>(_key: string, fallback: T) => useState(fallback);
  return { useBoolPref: pref, useNumberPref: pref };
});

import { getString } from "../../lib/i18n/index";
import { SearchHistoryGroup } from "./SearchHistoryGroup";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchHistoryGroup", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    recapQueriesCleared.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const switchFor = (key: "settings_pause_watch_history" | "settings_pause_search_history" | "settings_pause_search_suggestions") => {
    const label = getString(key);
    const row = [...host.querySelectorAll<HTMLElement>("*")].filter((element) => element.textContent?.includes(label) && element.querySelector("button, [role='switch'], input")).pop()!;
    return row.querySelector<HTMLElement>("button, [role='switch'], input")!;
  };
  const isOn = (toggle: HTMLElement) => toggle.getAttribute("aria-checked") === "true";

  it("starts with all three pause switches off", async () => {
    await act(async () => root.render(createElement(SearchHistoryGroup)));
    expect(isOn(switchFor("settings_pause_watch_history"))).toBe(false);
    expect(isOn(switchFor("settings_pause_search_history"))).toBe(false);
    expect(isOn(switchFor("settings_pause_search_suggestions"))).toBe(false);
  });

  it("forgets the recap's stored searches when search history is paused", async () => {
    await act(async () => root.render(createElement(SearchHistoryGroup)));
    const toggle = switchFor("settings_pause_search_history");

    await act(async () => toggle.click());
    expect(isOn(switchFor("settings_pause_search_history"))).toBe(true);
    expect(recapQueriesCleared).toHaveBeenCalledTimes(1);
    await act(async () => toggle.click());
    expect(recapQueriesCleared).toHaveBeenCalledTimes(1);
  });
});
