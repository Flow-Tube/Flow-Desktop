import { describe, expect, it } from "vitest";
import { signInErrorMessage } from "./useScrobbleSettings";
import { scrobbleTrack } from "./api/scrobble";
import { getString } from "./i18n/index";

describe("scrobbling sign-in errors", () => {
  it("shows the service's own words when it refused the sign-in", () => {
    expect(signInErrorMessage({ kind: "scrobbleSignInRejected", message: "Invalid username or password" }))
      .toBe("Invalid username or password");
    expect(signInErrorMessage({ kind: "scrobbleSignInRejected", message: " " })).toBe(getString("scrobbling_sign_in_failed"));
  });

  it("names each other failure", () => {
    expect(signInErrorMessage({ kind: "scrobbleKeyMissing", message: "x" })).toBe(getString("scrobbling_needs_key"));
    expect(signInErrorMessage({ kind: "network", message: "x" })).toBe(getString("scrobbling_sign_in_offline"));
    expect(signInErrorMessage({ kind: "keychain", message: "x" })).toBe(getString("scrobbling_keychain_unavailable"));
    expect(signInErrorMessage(new Error("boom"))).toBe(getString("scrobbling_sign_in_failed"));
  });
});

describe("scrobbleTrack", () => {
  it("sends every artist name and the album, and lets the backend pick the first", () => {
    const track = scrobbleTrack({
      id: "s",
      title: "Song",
      artists: [{ name: "Lead", id: null }, { name: "Guest", id: null }],
      album: { name: "Record", id: "a" },
      duration: 200,
      musicVideoType: null,
      thumbnail: "",
      explicit: false,
      videoId: "s",
      playlistId: null,
      params: null,
    }, 200_400.6);
    expect(track).toEqual({ title: "Song", artists: ["Lead", "Guest"], album: "Record", durationMs: 200_401 });
  });
});
