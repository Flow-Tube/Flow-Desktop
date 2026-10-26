import { describe, expect, it } from "vitest";

import { moveAfterId, orderByIds } from "./listOrder";

const items = (...ids: string[]) => ids.map((id) => ({ id }));
const idsOf = (list: Array<{ id: string }>) => list.map((item) => item.id);

describe("orderByIds", () => {
  it("follows the given order and sends unknown ids to the end in their own order", () => {
    expect(idsOf(orderByIds(items("a", "b", "c", "d"), ["c", "a"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("ranks a duplicated id by its first occurrence", () => {
    expect(idsOf(orderByIds(items("a", "b", "a"), ["a", "b", "a"]))).toEqual(["a", "a", "b"]);
  });
});

describe("moveAfterId", () => {
  const list = items("a", "b", "c", "d");

  it("moves an item after another", () => {
    expect(idsOf(moveAfterId(list, "a", "c"))).toEqual(["b", "c", "a", "d"]);
    expect(idsOf(moveAfterId(list, "d", "a"))).toEqual(["a", "d", "b", "c"]);
  });

  it("moves an item to the front when the anchor is null", () => {
    expect(idsOf(moveAfterId(list, "c", null))).toEqual(["c", "a", "b", "d"]);
  });

  it("returns the input untouched when nothing changes or an id is missing", () => {
    expect(moveAfterId(list, "b", "a")).toBe(list);
    expect(moveAfterId(list, "zzz", "a")).toBe(list);
    expect(moveAfterId(list, "a", "zzz")).toBe(list);
  });
});
