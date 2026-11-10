// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
afterEach(() => vi.resetModules());

async function rowInWindow(label: string): Promise<Element | null> {
  vi.doMock("../../lib/appWindow", () => ({ CURRENT_WINDOW_LABEL: label }));
  const { AddSubtitleFileRow } = await import("./SubtitleFilesRows");
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(AddSubtitleFileRow, { rowClass: "" })));
  const row = host.querySelector("button");
  await act(async () => root.unmount());
  return row;
}

describe("AddSubtitleFileRow", () => {
  it("shows in the main window", async () => {
    expect(await rowInWindow("main")).not.toBeNull();
  });

  it("is absent from the pop-out, which can't open a file dialog", async () => {
    expect(await rowInWindow("pip")).toBeNull();
  });
});
