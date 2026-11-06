import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalMediaFile, LocalMediaLibrary } from "../lib/api/localMedia";

const api = vi.hoisted(() => ({
  getLocalMediaLibrary: vi.fn(),
  onLocalScanStatus: vi.fn(() => Promise.resolve(() => {})),
  getLocalCover: vi.fn(() => Promise.resolve(null)),
  getLocalStream: vi.fn(() => new Promise(() => {})),
  addLocalMediaFolder: vi.fn(),
  removeLocalMediaFolder: vi.fn(),
  excludeLocalMediaFolder: vi.fn(),
  rescanLocalMedia: vi.fn(() => Promise.resolve()),
  cancelLocalMediaScan: vi.fn(() => Promise.resolve()),
  saveLocalPlayback: vi.fn(() => Promise.resolve()),
  trashLocalFile: vi.fn(() => Promise.resolve()),
  pickLocalSubtitle: vi.fn(),
}));
vi.mock("../lib/api/localMedia", () => api);

import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { useLocalMediaStore } from "../store/useLocalMediaStore";
import LocalMedia from "./LocalMedia";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scan = { running: false, done: 0, total: 0, truncated: false, failed: false };
const folder = { path: "/m", role: "include" as const, available: true };

const file = (overrides: Partial<LocalMediaFile>): LocalMediaFile => ({
  id: "local_0000000000000001",
  path: "/m/a.mp4",
  folderPath: "/m",
  kind: "video",
  title: "My film",
  fileName: "a.mp4",
  artist: "",
  album: "",
  durationMs: 600_000,
  sizeBytes: 1024,
  addedMs: Date.now() - 1000,
  modifiedMs: 0,
  width: 1920,
  height: 1080,
  frameRate: null,
  bitrateKbps: null,
  videoCodec: "h264",
  audioCodec: "aac",
  ...overrides,
});

let root: Root;
let container: HTMLElement;

async function show(library: Partial<LocalMediaLibrary>) {
  api.getLocalMediaLibrary.mockResolvedValue({ folders: [], files: [], plays: [], scan, ...library });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(LocalMedia)));
  });
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  useAppSettingsStore.setState({ values: {} });
  useLocalMediaStore.setState({
    loaded: false,
    loadError: false,
    files: [],
    folders: [],
    plays: new Map(),
    scan,
    kind: "video",
    view: "all",
    openFolder: null,
  });
  useLocalMediaStore.getState().updateFilters({ query: "" });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the Local media page", () => {
  it("asks for a folder on first run, with no filters to play with", async () => {
    await show({});
    expect(container.textContent).toContain("Choose your folders");
    expect(container.querySelector('input[type="search"]')).toBeNull();
  });

  it("says when the library can't be read, and offers a retry", async () => {
    api.getLocalMediaLibrary.mockRejectedValue(new Error("no"));
    container = document.createElement("div");
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(LocalMedia)));
    });
    expect(container.textContent).toContain("Couldn't read your library");
    expect(container.textContent).toContain("Retry");
  });

  it("explains an empty folder, and an empty one still being scanned", async () => {
    await show({ folders: [folder] });
    expect(container.textContent).toContain("No videos found");
    await act(async () => useLocalMediaStore.setState({ scan: { ...scan, running: true } }));
    expect(container.textContent).toContain("Scanning your folders");
  });

  it("lists files with New marks and Play all", async () => {
    await show({ folders: [folder], files: [file({})] });
    expect(container.textContent).toContain("My film");
    expect(container.textContent).toContain("New");
    expect(container.textContent).toContain("Play all");
    expect(container.textContent).toContain("1 video");
  });

  it("shows Continue watching for a file left part way", async () => {
    await show({
      folders: [folder],
      files: [file({})],
      plays: [{ fileId: file({}).id, positionMs: 60_000, durationMs: 600_000, lastPlayedMs: 5 }],
    });
    expect(container.textContent).toContain("Continue watching");
  });

  it("says when a search finds nothing", async () => {
    await show({ folders: [folder], files: [file({})] });
    await act(async () => useLocalMediaStore.getState().updateFilters({ query: "absent" }));
    expect(container.textContent).toContain("Nothing matches this");
    expect(container.textContent).not.toContain("Play all");
  });

  it("counts audio hidden by the length rule on the Music tab", async () => {
    await show({ folders: [folder], files: [file({ id: "local_0000000000000002", kind: "audio", durationMs: 5_000 })] });
    await act(async () => useLocalMediaStore.getState().setKind("audio"));
    expect(container.textContent).toContain("1 file hidden");
    expect(container.textContent).toContain("No music found");
  });

  it("names a folder that can't be reached", async () => {
    await show({ folders: [{ ...folder, available: false }] });
    expect(container.textContent).toContain("Can't reach this folder");
  });
});
