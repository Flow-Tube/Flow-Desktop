// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../lib/api/notes";

const api = vi.hoisted(() => ({
  deleteNotes: vi.fn(async () => {}),
  restoreNotes: vi.fn(async (notes: unknown[]) => notes),
  saveNotesOrder: vi.fn(async () => {}),
  saveNoteSubject: vi.fn(async () => {}),
  listNotes: vi.fn(async () => []),
  saveNote: vi.fn(),
}));
vi.mock("../lib/api/notes", async (original) => ({
  ...(await original<typeof import("../lib/api/notes")>()),
  ...api,
}));
vi.mock("../lib/api/youtube", () => ({ getVideoDetails: vi.fn(), getChannelDetails: vi.fn() }));
vi.mock("../lib/useProxiedImageUrl", () => ({ useProxiedImageUrl: () => undefined }));
const seek = vi.hoisted(() => ({ seekWhenVideoReady: vi.fn(), seekToTime: vi.fn() }));
vi.mock("../lib/playerSeek", () => seek);
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async () => true) }));
vi.mock("../lib/clipboard", () => clipboard);

const { Notes } = await import("./Notes");
const { useNotesStore } = await import("../store/useNotesStore");
const { useUiStore } = await import("../store/useUiStore");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (id: string, overrides: Partial<Note> = {}): Note => ({
  id: `video:${id}`,
  targetId: id,
  kind: "Video",
  text: `text ${id}`,
  updatedAt: 1,
  title: `Title ${id}`,
  ...overrides,
});

let host: HTMLDivElement;
let root: Root;
const onPlay = vi.fn();

function render(notes: Note[]) {
  useNotesStore.setState({
    notes: Object.fromEntries(notes.map((n) => [n.id, n])),
    loaded: true,
    loadError: false,
    editor: null,
  });
  act(() =>
    root.render(createElement(MemoryRouter, null, createElement(Notes, { onPlay }))),
  );
}

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`no button with "${text}" in: ${host.textContent}`);
  return found;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("Notes page", () => {
  it("has an empty state before there are notes", () => {
    render([]);
    expect(host.textContent).toContain("No notes yet");
  });

  it("offers a retry when notes couldn't be read", async () => {
    render([]);
    act(() => useNotesStore.setState({ loadError: true }));
    expect(host.textContent).toContain("Couldn't load your notes");
    await act(async () => button("Retry").click());
    expect(api.listNotes).toHaveBeenCalled();
  });

  it("says when nothing matches the search", () => {
    render([note("a")]);
    const input = host.querySelector("input") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "zzz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("No notes match");
  });

  it("opens a note and plays its video from a time in it", () => {
    render([note("a", { text: "1:05 the part", durationSeconds: 100 })]);
    act(() => button("Title a").click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Play from 1:05"]')?.click());
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: "a", title: "Title a" }));
    expect(seek.seekWhenVideoReady).toHaveBeenCalledWith(65);
  });

  it("has no Play for a channel note, and links to the channel", () => {
    render([note("UCx", { id: "channel:UCx", kind: "Channel" })]);
    act(() => button("Title UCx").click());
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Play")).toBe(false);
    expect(button("Channel")).toBeTruthy();
  });

  it("copies the selected notes with their links", async () => {
    render([note("a"), note("b")]);
    act(() => button("Select notes").click());
    act(() => button("Title a").click());
    await act(async () => button("Copy").click());
    expect(clipboard.copyText).toHaveBeenCalledWith(
      "Title a\nhttps://www.youtube.com/watch?v=a\ntext a",
    );
  });

  it("deletes selected notes and Undo brings them back", async () => {
    render([note("a"), note("b")]);
    act(() => button("Select notes").click());
    act(() => button("Select all").click());
    await act(async () => button("Delete").click());
    expect(api.deleteNotes).toHaveBeenCalledWith(["video:a", "video:b"]);
    expect(useNotesStore.getState().notes).toEqual({});

    const undo = useUiStore.getState().toast?.actions[0];
    expect(useUiStore.getState().toast?.message).toBe("2 notes deleted");
    await act(async () => undo?.onSelect?.());
    expect(Object.keys(useNotesStore.getState().notes)).toHaveLength(2);
  });

  it("reorders notes in the hand-made order", async () => {
    render([note("a", { position: 0 }), note("b", { position: 1 })]);
    act(() => button("Select notes").click());
    act(() => button("Reorder").click());
    const down = host.querySelector<HTMLButtonElement>('button[aria-label="Move down"]');
    await act(async () => down?.click());
    expect(api.saveNotesOrder).toHaveBeenCalledWith(["video:b", "video:a"]);
    expect(useNotesStore.getState().notes["video:b"]?.position).toBe(0);
  });
});
