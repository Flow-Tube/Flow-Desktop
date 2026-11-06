import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listNotes: vi.fn(),
  saveNote: vi.fn(),
  deleteNotes: vi.fn(),
  restoreNotes: vi.fn(),
  saveNotesOrder: vi.fn(),
  saveNoteSubject: vi.fn(),
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

  it("adopts the stored copy of a restored note and takes it away again on failure", async () => {
    api.restoreNotes.mockResolvedValueOnce([{ ...note("a", "x"), updatedAt: 50 }]);
    await useNotesStore.getState().restore([note("a", "x")]);
    expect(useNotesStore.getState().notes["video:a"]?.updatedAt).toBe(50);

    useNotesStore.setState({ notes: {} });
    api.restoreNotes.mockRejectedValueOnce(new Error("disk"));
    await useNotesStore.getState().restore([note("a", "x")]);
    expect(useNotesStore.getState().notes).toEqual({});
  });

  it("numbers a new order at once and rolls it back on failure", async () => {
    useNotesStore.setState({ notes: { "video:a": note("a", "x"), "video:b": note("b", "y") } });
    api.saveNotesOrder.mockResolvedValueOnce(undefined);
    await useNotesStore.getState().saveOrder(["video:b", "video:a"]);
    expect(useNotesStore.getState().notes["video:b"]?.position).toBe(0);
    expect(useNotesStore.getState().notes["video:a"]?.position).toBe(1);

    api.saveNotesOrder.mockRejectedValueOnce(new Error("disk"));
    await useNotesStore.getState().saveOrder(["video:a", "video:b"]);
    expect(useNotesStore.getState().notes["video:b"]?.position).toBe(0);
  });

  it("fills a subject in without touching the text or a note deleted meanwhile", async () => {
    const a = note("a", "x");
    useNotesStore.setState({ notes: { "video:a": a } });
    api.saveNoteSubject.mockResolvedValue(undefined);
    await useNotesStore.getState().fillSubject(a, { title: "Found" });
    expect(useNotesStore.getState().notes["video:a"]).toMatchObject({ text: "x", title: "Found", updatedAt: 1 });

    useNotesStore.setState({ notes: {} });
    await useNotesStore.getState().fillSubject(a, { title: "Again" });
    expect(useNotesStore.getState().notes).toEqual({});
  });

  it("marks a failed load so a page can say so", async () => {
    api.listNotes.mockRejectedValue(new Error("disk"));
    await useNotesStore.getState().load();
    expect(useNotesStore.getState()).toMatchObject({ loaded: true, loadError: true });
  });
});
