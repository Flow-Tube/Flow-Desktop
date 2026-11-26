import { describe, expect, it } from "vitest";
import { describeLoadError, loadErrorCopy, screenErrorCopy, type LoadErrorCopy } from "./loadErrorCopy";
import { getString } from "./i18n/index";

describe("loadErrorCopy", () => {
  it("names the failures worth telling apart", () => {
    expect(loadErrorCopy("rateLimited")?.title).toBe("player_error_rate_limited_title");
    expect(loadErrorCopy("botCheckRequired")?.hint).toBe("load_error_bot_hint");
    expect(loadErrorCopy("networkWall")?.title).toBe("player_error_network_wall_title");
  });

  it("leaves other kinds to the screen", () => {
    expect(loadErrorCopy("extractor")).toBeNull();
    expect(loadErrorCopy(null)).toBeNull();
  });
});

describe("describeLoadError", () => {
  it("says offline and that the screen loads again by itself", () => {
    const error = { kind: "network", message: "browse: error sending request for url (https://music.youtube.com/)" };
    expect(describeLoadError(error, "music_error_generic")).toBe(getString("load_error_offline"));
  });

  it("never shows the backend's own text", () => {
    const error = { kind: "extractor", message: "JSON error: expected value at line 1" };
    expect(describeLoadError(error, "music_error_generic")).toBe(getString("music_error_generic"));
    expect(describeLoadError(new Error("boom"), "music_error_generic")).toBe(getString("music_error_generic"));
  });
});

describe("screenErrorCopy", () => {
  const home: LoadErrorCopy = { title: "home_feed_error_title", hint: "home_feed_error_body" };

  it("names a network block instead of the connection", () => {
    expect(screenErrorCopy("networkWall", home)).toEqual({
      title: "player_error_network_wall_title",
      hint: "player_error_network_wall_hint",
    });
    expect(screenErrorCopy("rateLimited", home).title).toBe("player_error_rate_limited_title");
  });

  it("keeps the screen's own copy offline and for failures without a name", () => {
    expect(screenErrorCopy("network", home)).toBe(home);
    expect(screenErrorCopy("local", home)).toBe(home);
    expect(screenErrorCopy(null, home)).toBe(home);
  });
});
