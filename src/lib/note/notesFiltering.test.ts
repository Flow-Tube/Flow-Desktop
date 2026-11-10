import { describe, expect, it } from "vitest";
import { moved, shareText, visibleNotes } from "./notesFiltering";
import type { Note } from "../api/notes";

const note = (id: string, overrides: Partial<Note> = {}): Note => ({
  id: `video:${id}`,
  targetId: id,
  kind: "Video",
  text: id,
  updatedAt: 0,
  ...overrides,
});

const ids = (notes: Note[]) => notes.map((n) => n.targetId);

describe("visibleNotes", () => {
  const notes = [
    note("a", { updatedAt: 1, title: "Zebra café" }),
    note("b", { updatedAt: 3, title: "apple", channelName: "Fruit channel" }),
    note("c", { updatedAt: 2, kind: "Channel", id: "channel:c", title: "Mango" }),
  ];

  it("sorts by edit time, title and either way", () => {
    expect(ids(visibleNotes(notes, "", "all", "recent"))).toEqual(["b", "c", "a"]);
    expect(ids(visibleNotes(notes, "", "all", "oldest"))).toEqual(["a", "c", "b"]);
    expect(ids(visibleNotes(notes, "", "all", "title"))).toEqual(["b", "c", "a"]);
  });

  it("sorts a note with no title by its text", () => {
    const list = [note("z", { text: "banana" }), note("y", { title: "cherry" })];
    expect(ids(visibleNotes(list, "", "all", "title"))).toEqual(["z", "y"]);
  });

  it("puts notes placed by hand first, the rest newest edit first", () => {
    const list = [
      note("new", { updatedAt: 9 }),
      note("second", { position: 1 }),
      note("older", { updatedAt: 5 }),
      note("first", { position: 0 }),
    ];
    expect(ids(visibleNotes(list, "", "all", "custom"))).toEqual(["first", "second", "new", "older"]);
  });

  it("filters by kind", () => {
    expect(ids(visibleNotes(notes, "", "channels", "recent"))).toEqual(["c"]);
    expect(ids(visibleNotes(notes, "", "videos", "recent"))).toEqual(["b", "a"]);
  });

  it("needs every word, in the note, title or channel, without regard to case or accents", () => {
    expect(ids(visibleNotes(notes, "fruit APPLE", "all", "recent"))).toEqual(["b"]);
    expect(ids(visibleNotes(notes, "cafe", "all", "recent"))).toEqual(["a"]);
    expect(visibleNotes(notes, "apple zebra", "all", "recent")).toEqual([]);
  });
});

describe("shareText", () => {
  it("gives each note's title and link, then the note", () => {
    expect(
      shareText([
        note("abc", { title: "A video", text: "first" }),
        note("UCx", { id: "channel:UCx", kind: "Channel", text: "second" }),
      ]),
    ).toBe(
      "A video\nhttps://www.youtube.com/watch?v=abc\nfirst\n\nhttps://www.youtube.com/channel/UCx\nsecond",
    );
  });
});

describe("moved", () => {
  it("moves an item and stays put at the ends", () => {
    expect(moved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moved(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
