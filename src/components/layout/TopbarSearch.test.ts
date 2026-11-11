import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TopbarSearch } from "./TopbarSearch";
import { useSettingsSearchStore } from "../../store/useSettingsSearchStore";
import { getString } from "../../lib/i18n/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function renderTopbarSearch(path = "/") {
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(TopbarSearch)));
  });
}

describe("TopbarSearch", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    useSettingsSearchStore.getState().clearQuery();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useSettingsSearchStore.getState().clearQuery();
  });

  it("renders default search placeholder on standard routes", () => {
    renderTopbarSearch("/");
    const input = host.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe(getString("search_placeholder"));
  });

  it("renders settings search placeholder when on /settings", () => {
    renderTopbarSearch("/settings");
    const input = host.querySelector("input");
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe(getString("settings_search_placeholder"));
  });

  it("updates useSettingsSearchStore when typing on /settings", () => {
    renderTopbarSearch("/settings");
    const input = host.querySelector("input")!;
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(input, "ambient");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(useSettingsSearchStore.getState().query).toBe("ambient");
  });

  it("clears useSettingsSearchStore when clicking clear button on /settings", () => {
    useSettingsSearchStore.getState().setQuery("playback");
    renderTopbarSearch("/settings");
    const input = host.querySelector("input")!;
    expect(input.value).toBe("playback");

    const clearBtn = host.querySelector("button[title*='Clear'], button[aria-label*='Clear']");
    expect(clearBtn).not.toBeNull();
    act(() => {
      clearBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(useSettingsSearchStore.getState().query).toBe("");
  });

  it("clears settings query on Escape key press when on /settings", () => {
    useSettingsSearchStore.getState().setQuery("volume");
    renderTopbarSearch("/settings");
    const input = host.querySelector("input")!;
    expect(input.value).toBe("volume");

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(useSettingsSearchStore.getState().query).toBe("");
  });
});
