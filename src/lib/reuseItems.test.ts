import { describe, expect, it } from "vitest";
import { reuseById, reuseIfSame } from "./reuseItems";

const item = (id: string, title = id) => ({ id, title });
const overTheWire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("reuseById", () => {
  it("hands back the same list when the new one repeats it", () => {
    const previous = [item("a"), item("b")];
    expect(reuseById(previous, overTheWire(previous))).toBe(previous);
  });

  it("keeps the objects of items that did not change, wherever they moved", () => {
    const previous = [item("a"), item("b")];
    const next = reuseById(previous, overTheWire([item("new"), item("b"), item("a")]));
    expect(next.map((entry) => entry.id)).toEqual(["new", "b", "a"]);
    expect(next[1]).toBe(previous[1]);
    expect(next[2]).toBe(previous[0]);
  });

  it("takes the new object for an item whose data changed", () => {
    const previous = [item("a")];
    const next = reuseById(previous, [item("a", "Renamed")]);
    expect(next[0]).not.toBe(previous[0]);
    expect(next[0]?.title).toBe("Renamed");
  });

  it("returns a shorter list as a new one", () => {
    const previous = [item("a"), item("b")];
    const next = reuseById(previous, overTheWire([item("a")]));
    expect(next).not.toBe(previous);
    expect(next[0]).toBe(previous[0]);
  });
});

describe("reuseIfSame", () => {
  it("keeps the old value when the data is the same", () => {
    const previous = { a: { kind: "search" } };
    expect(reuseIfSame(previous, overTheWire(previous))).toBe(previous);
    const changed = { a: { kind: "related" } };
    expect(reuseIfSame(previous, changed)).toBe(changed);
  });
});
