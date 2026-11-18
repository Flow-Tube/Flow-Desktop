import { describe, expect, it } from "vitest";
import { EMPTY_HOME_SNAPSHOT, type HomeAppend, type HomeCard, type HomeSnapshot } from "./api/homeFeed";
import { acceptAppend, acceptSnapshot, acceptStatus } from "./homeFeedUpdates";

const card = (id: string, title = id): HomeCard => ({ id, title, publishedAtMs: 0 }) as HomeCard;

const feed = (ids: string[], extra: Partial<HomeSnapshot> = {}): HomeSnapshot => ({
  ...EMPTY_HOME_SNAPSHOT,
  generation: 2,
  cards: ids.map((id) => card(id)),
  origins: Object.fromEntries(ids.map((id) => [id, { kind: "search" as const }])),
  hasMore: true,
  ...extra,
});

// What arrives over IPC is parsed afresh, so nothing in it is the object the page holds.
const overTheWire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("acceptStatus", () => {
  it("changes the flags and keeps every card and the list itself", () => {
    const current = feed(["a", "b"]);
    const next = acceptStatus(current, { ...overTheWire(current), loadingMore: true });
    expect(next.loadingMore).toBe(true);
    expect(next.cards).toBe(current.cards);
    expect(next.origins).toBe(current.origins);
  });

  it("returns the same snapshot when no flag moved, so nothing re-renders", () => {
    const current = feed(["a"]);
    expect(acceptStatus(current, overTheWire(current))).toBe(current);
  });

  it("ignores the flags of another load", () => {
    const current = feed(["a"]);
    expect(acceptStatus(current, { ...current, generation: 1, loading: true })).toBe(current);
  });
});

describe("acceptAppend", () => {
  const page = (start: number, ids: string[], generation = 2): HomeAppend => ({
    generation,
    loading: false,
    loadingMore: false,
    hasMore: true,
    loadMoreFailed: false,
    error: null,
    start,
    cards: ids.map((id) => card(id)),
    origins: Object.fromEntries(ids.map((id) => [id, { kind: "related" as const }])),
  });

  it("adds the page after the cards it holds, which keep their objects", () => {
    const current = feed(["a", "b"]);
    const next = acceptAppend(current, page(2, ["c", "d"]));
    expect(next?.cards.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(next?.cards[0]).toBe(current.cards[0]);
    expect(next?.cards[1]).toBe(current.cards[1]);
    expect(next?.origins.c).toEqual({ kind: "related" });
    expect(next?.origins.a).toBe(current.origins.a);
    expect(next).not.toHaveProperty("start");
  });

  it("asks for the whole snapshot when a page does not follow what it holds", () => {
    expect(acceptAppend(feed(["a", "b"]), page(5, ["x"]))).toBeNull();
    expect(acceptAppend(feed(["a", "b"]), page(2, ["x"], 3))).toBeNull();
  });

  it("ignores a page of an older load", () => {
    const current = feed(["a"]);
    expect(acceptAppend(current, page(1, ["x"], 1))).toBe(current);
  });
});

describe("acceptSnapshot", () => {
  it("keeps the objects of cards that did not change", () => {
    const current = feed(["a", "b", "c"]);
    const next = acceptSnapshot(current, overTheWire(feed(["a", "late", "b", "c"])));
    expect(next.cards.map((item) => item.id)).toEqual(["a", "late", "b", "c"]);
    expect(next.cards[0]).toBe(current.cards[0]);
    expect(next.cards[2]).toBe(current.cards[1]);
    expect(next.cards[3]).toBe(current.cards[2]);
  });

  it("keeps the list itself when a snapshot repeats what is shown", () => {
    const current = feed(["a", "b"]);
    const next = acceptSnapshot(current, overTheWire({ ...current, loadingMore: true }));
    expect(next.cards).toBe(current.cards);
    expect(next.origins).toBe(current.origins);
    expect(next.loadingMore).toBe(true);
  });

  it("takes a card whose details changed", () => {
    const current = feed(["a"]);
    const next = acceptSnapshot(current, { ...current, cards: [card("a", "New title")] });
    expect(next.cards[0]).not.toBe(current.cards[0]);
    expect(next.cards[0]?.title).toBe("New title");
  });

  it("never lets an older load replace a newer one", () => {
    const current = feed(["a"]);
    expect(acceptSnapshot(current, feed(["z"], { generation: 1 }))).toBe(current);
  });
});
