import { describe, expect, it } from "vitest";
import { describeLoadError, loadErrorCopy } from "./loadErrorCopy";
import { getString } from "./i18n/index";

describe("loadErrorCopy", () => {
  it("names the failures worth telling apart", () => {
    expect(loadErrorCopy("rateLimited")?.title).toBe("player_error_rate_limited_title");
    expect(loadErrorCopy("botCheckRequired")?.hint).toBe("load_error_bot_hint");
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
