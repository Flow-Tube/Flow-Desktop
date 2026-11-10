import { describe, expect, it, vi } from "vitest";

vi.mock("./strings.json", () => ({
  default: {
    plain: "Plain",
    one_arg: "Hello %s",
    number_arg: "%d songs",
    positional: "%2$s by %1$s",
    percent: "100% of %s",
    tracks_one: "%d track",
    tracks_other: "%d tracks",
    only_other_other: "%d items",
  },
}));

import { getPlural, getString, type StringKey } from "./index";

const text = (key: string, ...args: unknown[]) => getString(key as StringKey, ...args);

describe("getString", () => {
  it("fills placeholders in order or by position", () => {
    expect(text("plain")).toBe("Plain");
    expect(text("one_arg", "Flow")).toBe("Hello Flow");
    expect(text("number_arg", 3)).toBe("3 songs");
    expect(text("positional", "Artist", "Song")).toBe("Song by Artist");
  });

  it("leaves a bare percent sign and a missing argument alone", () => {
    expect(text("percent", "it")).toBe("100% of it");
    expect(text("one_arg")).toBe("Hello %s");
  });

  it("falls back to the key", () => {
    expect(text("unknown_key")).toBe("unknown_key");
  });
});

describe("getPlural", () => {
  it("picks the form the language uses for the count", () => {
    expect(getPlural("tracks", 1)).toBe("1 track");
    expect(getPlural("tracks", 2)).toBe("2 tracks");
    expect(getPlural("only_other", 1)).toBe("1 items");
  });
});
