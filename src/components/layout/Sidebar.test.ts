import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Sidebar } from "./Sidebar";
import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function renderSidebar(showShorts: boolean) {
  useAppSettingsStore.setState({
    values: { ...useAppSettingsStore.getState().values, [SETTINGS.SHORTS_CONTENT_ENABLED]: String(showShorts) },
  });
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(Sidebar, { mode: "overlay" })));
  });
  return Array.from(host.querySelectorAll("a")).map((link) => link.getAttribute("href"));
}

describe("Sidebar", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("links to Saved Shorts only while Shorts show", () => {
    expect(renderSidebar(true)).toContain("/saved-shorts");
    expect(renderSidebar(false)).not.toContain("/saved-shorts");
  });
});
