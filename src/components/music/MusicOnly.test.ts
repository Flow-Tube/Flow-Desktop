import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MusicOnly } from "./MusicOnly";
import { SETTINGS } from "../../lib/settings/schema";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function open(path: string, musicEnabled: boolean) {
  useAppSettingsStore.setState({ values: { [SETTINGS.MUSIC_CONTENT_ENABLED]: String(musicEnabled) } });
  act(() => {
    root.render(createElement(MemoryRouter, { key: `${path}:${musicEnabled}`, initialEntries: [path] },
      createElement(Routes, null,
        createElement(Route, { path: "/", element: createElement("p", null, "home") }),
        createElement(Route, { element: createElement(MusicOnly) },
          createElement(Route, { path: "/music", element: createElement("p", null, "music home") })))));
  });
  return host.textContent;
}

describe("MusicOnly", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useAppSettingsStore.setState({ values: {} });
  });

  it("opens a music page while Show Music is on and leads Home while it is off", () => {
    expect(open("/music", true)).toBe("music home");
    expect(open("/music", false)).toBe("home");
  });
});
