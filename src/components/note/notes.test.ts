// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ saveNote: vi.fn(async () => null), deleteNotes: vi.fn(), listNotes: vi.fn() }));
vi.mock("../../lib/api/notes", async (original) => ({
  ...(await original<typeof import("../../lib/api/notes")>()),
  ...api,
}));

const { NoteCard } = await import("./NoteCard");
const { NoteEditorHost } = await import("./NoteEditorHost");
const { useNotesStore } = await import("../../store/useNotesStore");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  useNotesStore.setState({ notes: {}, editor: null });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

function buttonWith(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`no button with ${text}`);
  return found;
}

describe("NoteCard", () => {
  it("seeks when a time in the note is clicked", () => {
    const onSeek = vi.fn();
    act(() => root.render(createElement(NoteCard, { text: "see 1:05 here", onEdit: vi.fn(), onSeek })));
    act(() => buttonWith("1:05").click());
    expect(onSeek).toHaveBeenCalledWith(65);
  });

  it("leaves a time past the end of the video as plain text", () => {
    const onSeek = vi.fn();
    act(() =>
      root.render(createElement(NoteCard, { text: "see 9:00", onEdit: vi.fn(), onSeek, durationSeconds: 60 })),
    );
    expect(host.querySelectorAll("button")).toHaveLength(1);
  });

  it("has no time links where there is no player to seek", () => {
    act(() => root.render(createElement(NoteCard, { text: "see 1:05", onEdit: vi.fn() })));
    expect(host.querySelectorAll("button")).toHaveLength(1);
  });

  it("opens the editor without expanding the card", () => {
    const onEdit = vi.fn();
    act(() => root.render(createElement(NoteCard, { text: "hello", onEdit })));
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label]")?.click());
    expect(onEdit).toHaveBeenCalledOnce();
    expect(host.querySelector(".line-clamp-3")).not.toBeNull();
  });
});

describe("NoteEditorHost", () => {
  const open = (insertAtSeconds?: number) =>
    act(() => useNotesStore.getState().openEditor({ kind: "Video", targetId: "abc", subject: { title: "T" }, insertAtSeconds }));

  it("says while it is mounted, so a window without it offers no note row", () => {
    act(() => root.render(createElement(NoteEditorHost)));
    expect(useNotesStore.getState().editorHosted).toBe(true);
    act(() => root.render(null));
    expect(useNotesStore.getState().editorHosted).toBe(false);
  });

  it("starts from the stored note and saves through the store", async () => {
    useNotesStore.setState({
      notes: { "video:abc": { id: "video:abc", kind: "Video", targetId: "abc", text: "old", updatedAt: 1 } },
    });
    act(() => root.render(createElement(NoteEditorHost)));
    open();
    expect(host.querySelector("textarea")?.value).toBe("old");
    await act(async () => buttonWith("Save").click());
    expect(api.saveNote).toHaveBeenCalledWith("Video", "abc", "old", { title: "T" });
    expect(useNotesStore.getState().editor).toBeNull();
  });

  it("writes the playing position in at the chip", () => {
    act(() => root.render(createElement(NoteEditorHost)));
    open(754);
    act(() => buttonWith("12:34").click());
    expect(host.querySelector("textarea")?.value).toBe("12:34 ");
  });

  it("offers no chip where there is no position", () => {
    act(() => root.render(createElement(NoteEditorHost)));
    open();
    expect(host.textContent).not.toContain("Insert");
  });

  it("closes on Escape without saving and hides keys from the player", () => {
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    act(() => root.render(createElement(NoteEditorHost)));
    open();
    host.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    expect(behind).not.toHaveBeenCalled();
    act(() => {
      host.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    window.removeEventListener("keydown", behind);
    expect(useNotesStore.getState().editor).toBeNull();
    expect(api.saveNote).not.toHaveBeenCalled();
  });
});
