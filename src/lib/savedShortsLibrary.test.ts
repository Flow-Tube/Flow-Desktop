import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => new Map<string, string>());
vi.mock("./api/db", () => ({
  getSetting: vi.fn(async (key: string) => stored.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => void stored.set(key, value)),
}));
vi.mock("./api/youtube", () => ({ getVideoDetails: vi.fn() }));

const { loadSavedShorts, removeShortFromLibrary, saveShortToLibrary } = await import("./savedShortsLibrary");

const short = (id: string) => ({ type: "short" as const, id, title: `Short ${id}` });

beforeEach(() => stored.clear());

describe("savedShortsLibrary", () => {
  it("records when a Short was saved, newest first, for the phone to read", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    await saveShortToLibrary(short("a"));
    await saveShortToLibrary(short("b"));
    const list = await loadSavedShorts({ repairTitles: false });
    expect(list.map((s) => s.id)).toEqual(["b", "a"]);
    expect(list[0]?.addedAtInPlaylist).toBe(1234);
  });

  it("keeps what sync stored through a later edit", async () => {
    stored.set(
      "saved_shorts_library",
      JSON.stringify([{ ...short("a"), addedAtInPlaylist: 7, durationSeconds: 30 }, short("b")]),
    );
    await removeShortFromLibrary("b");
    const list = await loadSavedShorts({ repairTitles: false });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ addedAtInPlaylist: 7, durationSeconds: 30 });
  });

  it("never drops old saves, which would delete them on the phone", async () => {
    stored.set(
      "saved_shorts_library",
      JSON.stringify(Array.from({ length: 1500 }, (_, i) => short(`s${i}`))),
    );
    await saveShortToLibrary(short("new"));
    expect((await loadSavedShorts({ repairTitles: false })).length).toBe(1501);
  });
});
