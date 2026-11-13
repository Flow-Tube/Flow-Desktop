import { describe, expect, it } from "vitest";
import { claimStartPage, startPageChoices, startPagePath } from "./startPage";

const all = { shorts: true, music: true, explore: true };

describe("startPagePath", () => {
  it("uses Flow for Android's tab ids", () => {
    expect(startPagePath("3", all)).toBe("/subscriptions");
    expect(startPagePath("0", all)).toBe("/");
    expect(startPagePath("6", all)).toBe("/explore");
  });

  it("opens Home for an unknown value or a page that is turned off", () => {
    expect(startPagePath(null, all)).toBe("/");
    expect(startPagePath("5", all)).toBe("/");
    expect(startPagePath("1", { ...all, shorts: false })).toBe("/");
    expect(startPagePath("2", { ...all, music: false })).toBe("/");
  });
});

describe("startPageChoices", () => {
  it("leaves out pages whose tab is off", () => {
    const paths = startPageChoices({ shorts: false, music: true, explore: false }).map((page) => page.path);
    expect(paths).toEqual(["/", "/subscriptions", "/music", "/library"]);
  });
});

describe("claimStartPage", () => {
  it("applies once per launch, so a reload keeps the current page", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
    expect(claimStartPage(storage)).toBe(true);
    expect(claimStartPage(storage)).toBe(false);
  });
});
