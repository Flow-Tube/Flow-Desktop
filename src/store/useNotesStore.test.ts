import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listNotes: vi.fn(),
  saveNote: vi.fn(),
  deleteNotes: vi.fn(),
}));
vi.mock("../lib/api/notes", async (original) => ({
  ...(await original<typeof import("../lib/api/notes")>()),
  ...api,
}));

const { useNotesStore } = await import("./useNotesStore");
const { useUiStore } = await import("./useUiStore");

const note = (targetId: string, text: string) => ({
  id: `video:${targetId}`,
  targetId,
  kind: "Video" as const,
  text,
  updatedAt: 1,
});

beforeEach(() => {
  useNotesStore.setState({ notes: {}, loaded: false, loadError: false, editor: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.clearAllMocks());

describe("useNotesStore", () => {
  it("shows a saved note at once and adopts the backend's copy", async () => {
    let finish: (value: unknown) => void = () => {};
    api.saveNote.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const saving = useNotesStore.getState().save("Video", "a", "  hello ", { title: "T" });
    expect(useNotesStore.getState().notes["video:a"]?.text).toBe("hello");
    expect(useNotesStore.getState().notes["video:a"]?.title).toBe("T");
    finish({ ...note("a", "hello"), updatedAt: 99 });
    await saving;
    expect(useNotesStore.getState().notes["video:a"]?.updatedAt).toBe(99);
  });

  it("puts everything back when the save fails", async () => {
    useNotesStore.setState({ notes: { "video:a": note("a", "old") } });
    api.saveNote.mockRejectedValue(new Error("disk"));
    const showToast = vi.spyOn(useUiStore.getState(), "showToast");
    await useNotesStore.getState().save("Video", "a", "new", null);
    expect(useNotesStore.getState().notes["video:a"]?.text).toBe("old");
    expect(showToast).toHaveBeenCalledOnce();
  });

  it("treats blank text as deleting the note", async () => {
    useNotesStore.setState({ notes: { "video:a": note("a", "old") } });
    api.saveNote.mockResolvedValue(null);
    await useNotesStore.getState().save("Video", "a", "   ", null);
    expect(useNotesStore.getState().notes["video:a"]).toBeUndefined();
  });

  it("restores deleted notes when the backend refuses", async () => {
    useNotesStore.setState({ notes: { "video:a": note("a", "x"), "video:b": note("b", "y") } });
    api.deleteNotes.mockRejectedValue(new Error("disk"));
    await useNotesStore.getState().remove(["video:a"]);
    expect(Object.keys(useNotesStore.getState().notes)).toEqual(["video:a", "video:b"]);
  });

  it("marks a failed load so a page can say so", async () => {
    api.listNotes.mockRejectedValue(new Error("disk"));
    await useNotesStore.getState().load();
    expect(useNotesStore.getState()).toMatchObject({ loaded: true, loadError: true });
  });
});
